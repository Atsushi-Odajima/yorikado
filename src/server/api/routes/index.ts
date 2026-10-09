import 'server-only';
import type { Route } from '../router';
import { adminRoutes } from './admin';
import { authRoutes } from './auth';
import { moneyRoutes } from './money';
import { voucherRoutes } from './vouchers';
import { workRoutes } from './work';

export const routes: Route[] = [...authRoutes, ...voucherRoutes, ...moneyRoutes, ...workRoutes, ...adminRoutes];
