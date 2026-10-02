"""Static, atomic Nginx release; shared credentials stay outside this repository."""
from pathlib import Path
from datetime import datetime, UTC
import argparse
import gzip
import shutil
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--blog-root', type=Path, default=ROOT.parent / 'ai-blog')
args = parser.parse_args()
sys.path.insert(0, str(args.blog_root.parent / 'ai-quantitative-trading' / 'scripts' / 'remote'))
from remote_client import RemoteClient

source = ROOT / 'dist' / 'parking' / 'browser'
if '/smartParking/' not in (source / 'index.html').read_text(encoding='utf-8'):
    raise RuntimeError('Build first with npm run build (production base href)')
release = datetime.now(UTC).strftime('%Y%m%d%H%M%S')
stage = (ROOT / '.deploy' / release).resolve()
if not stage.is_relative_to((ROOT / '.deploy').resolve()):
    raise RuntimeError('Staging directory escaped deployment root')
target = stage / 'smartParking'
shutil.copytree(source, target)
for file in target.rglob('*'):
    if file.is_file() and file.suffix in ('.js', '.css', '.glb', '.html', '.svg', '.json'):
        with file.open('rb') as src, gzip.open(str(file) + '.gz', 'wb', compresslevel=9) as dst:
            shutil.copyfileobj(src, dst)
archive = ROOT / '.deploy' / f'parking-{release}.tar.gz'
with tarfile.open(archive, 'w:gz') as bundle:
    bundle.add(target, arcname='smartParking')
remote = RemoteClient()
try:
    remote.upload_file(archive, f'/tmp/{archive.name}', 0o600)
    remote.upload_file(ROOT / 'deploy' / 'nginx-location.conf', '/tmp/parking-nginx-location.conf', 0o600)
    print(remote.run(f'''
set -euo pipefail
root=/opt/3d-smart-parking
release="$root/releases/{release}"
mkdir -p "$release"
tar -xzf /tmp/{archive.name} -C "$release"
chown -R aiapps:aiapps "$release"
chmod -R a+rX "$release"
config=/etc/nginx/snippets/ai-platform-routes.conf
backup="$root/nginx-routes-{release}.backup"
cp "$config" "$backup"
previous=$(readlink "$root/www" || true)
rollback() {{
    cp "$backup" "$config"
    if [ -n "$previous" ]; then ln -sfn "$previous" "$root/www"; else rm -f "$root/www"; fi
    nginx -t && systemctl reload nginx
}}
trap rollback ERR
if ! grep -q 'smart-parking-static-app' "$config"; then cat /tmp/parking-nginx-location.conf >> "$config"; fi
if ! grep -q 'location = /smartParking/index.html' "$config"; then
 cat >> "$config" <<'NGINX'
    location = /smartParking/index.html {{
        root /opt/3d-smart-parking/www;
        expires -1;
        gzip_static on;
    }}
NGINX
fi
ln -sfn "$release" "$root/www.next"
mv -Tf "$root/www.next" "$root/www"
nginx -t
systemctl reload nginx
for path in /smartParking/ /smartParking/mobile /smartParking/models/campus-desktop-v2.glb /smartParking/models/campus-mobile-v2.glb /smartParking/models/vehicle-desktop-v3.glb /smartParking/models/vehicle-mobile-v3.glb /smartParking/models/vehicle-placements-v3.json /smartParking/models/vehicle-rig-v3.json /smartParking/models/traffic-routes-v3.json /smartParking/media/opening-v3.mp4; do
 curl -fsS --resolve caibinice.com:443:127.0.0.1 "https://caibinice.com$path" -o /dev/null
done
trap - ERR
rm -f /tmp/{archive.name} /tmp/parking-nginx-location.conf
echo 'Parking release activated: {release}'
echo "Rollback: $backup; previous release: $previous"
''', root=True, timeout=180))
finally:
    remote.close()
    shutil.rmtree(stage)
    archive.unlink(missing_ok=True)
