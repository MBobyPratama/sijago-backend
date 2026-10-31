import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "./services/auth.service.js";
export const authContext = new AsyncLocalStorage<AuthUser>();
