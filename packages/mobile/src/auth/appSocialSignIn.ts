import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { appAuthClient, appBackendUrl } from "./appAuthClient";
import { readSocialSignInConfig, visibleSocialProviders, type SocialSignInDependencies } from "./socialSignIn";

/** Apple and Google buttons the app shows, from Expo config `extra.socialSignIn` (Apple is off by default). */
export const appSocialProviders = visibleSocialProviders(readSocialSignInConfig(Constants.expoConfig), Platform.OS);

export const appSocialSignIn: SocialSignInDependencies = {
  client: appAuthClient,
  backendUrl: appBackendUrl,
  platform: Platform.OS,
  browser: WebBrowser,
  appleNative: {
    // Email only: the backend stores no name (data minimisation, HEN-238).
    signInAsync: () => AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL] }),
  },
};
