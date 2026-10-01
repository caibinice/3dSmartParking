import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'mobile', data: { mobile: true }, loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'parking', redirectTo: '', pathMatch: 'full' },
  { path: 'parkingV2', redirectTo: '', pathMatch: 'full' },
  { path: '**', redirectTo: '' }
];
