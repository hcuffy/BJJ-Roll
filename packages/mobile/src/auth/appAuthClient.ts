import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { readBackendUrl } from "./authConfig";
import { createMobileAuthClient } from "./authClient";

/** Where the app keeps the session; sign-out deletes its keys here. */
export const appSecureStore = SecureStore;

/** The app's auth client: backend URL from Expo config, session kept only in SecureStore. */
/** Backend origin; the account routes (HEN-65) sit outside /api/auth, so they are called by absolute URL. */
export const appBackendUrl = readBackendUrl(Constants.expoConfig);
export const appAuthClient = createMobileAuthClient({ backendUrl: appBackendUrl, storage: SecureStore });
