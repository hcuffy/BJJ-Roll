import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { readBackendUrl } from "./authConfig";
import { createMobileAuthClient } from "./authClient";

/** The app's auth client: backend URL from Expo config, session kept only in SecureStore. */
export const appAuthClient = createMobileAuthClient({ backendUrl: readBackendUrl(Constants.expoConfig), storage: SecureStore });
