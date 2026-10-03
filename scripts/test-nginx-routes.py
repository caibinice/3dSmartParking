import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("routes", ROOT / "scripts" / "update-nginx-routes.py")
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)

class RoutesTest(unittest.TestCase):
    def test_preserves_other_apps_and_replaces_nested_parking(self):
        old = """add_header Permissions-Policy \"microphone=()\" always;
location /quant/ { try_files $uri $uri/ /quant/index.html; }
    # smart-parking-static-app
    location = /smartParking { return 301 /smartParking/; }
    location ^~ /smartParking/ {
      location ~ ^/smartParking/models/.*\\.glb$ { expires 1h; }
    }
    location = /smartParking/index.html { expires -1; }
location /another-app/ { return 200 'ok'; }
"""
        snippet = (ROOT / "deploy" / "nginx-location.conf").read_text(encoding="utf-8")
        updated = routes.update(old, snippet)
        self.assertIn("location /quant/", updated)
        self.assertIn("location /another-app/", updated)
        self.assertEqual(updated.count("location ^~ /smartParking/"), 1)
        self.assertEqual(updated.count("location = /smartParking/index.html"), 1)
        self.assertEqual(updated.count("location = /smartCockpit/api/parking-agent/stream"), 1)
        self.assertEqual(updated.count("location = /smartCockpit/api/parking/ag-ui"), 1)
        self.assertEqual(updated.count("location = /smartCockpit/api/parking/vision"), 1)
        self.assertIn('"microphone=()" always;', updated)
        self.assertIn('microphone=(self)', updated)
        self.assertIn('proxy_buffering off', updated)
        self.assertEqual(routes.update(updated, snippet), updated)

    def test_broken_config_is_not_overwritten(self):
        with self.assertRaises(ValueError):
            routes.update("location ^~ /smartParking/ {", "new")

if __name__ == "__main__": unittest.main()
