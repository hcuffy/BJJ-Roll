import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { readBackendUrl } from "./authConfig";
import { createMobileAuthClient } from "./authClient";

export const appSecureStore = SecureStore;

export const appBackendUrl = readBackendUrl(Constants.expoConfig);
export const appAuthClient = createMobileAuthClient({ backendUrl: appBackendUrl, storage: SecureStore });
