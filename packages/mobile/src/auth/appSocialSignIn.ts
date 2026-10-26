import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { appAuthClient, appBackendUrl } from "./appAuthClient";
import { readSocialSignInConfig, visibleSocialProviders, type SocialSignInDependencies } from "./socialSignIn";

const NONCE_BYTES = 32;

/** Apple and Google buttons the app shows, from Expo config `extra.socialSignIn` (Apple is off by default). */
export const appSocialProviders = visibleSocialProviders(readSocialSignInConfig(Constants.expoConfig), Platform.OS);

export const appSocialSignIn: SocialSignInDependencies = {
  client: appAuthClient,
  backendUrl: appBackendUrl,
  platform: Platform.OS,
  browser: WebBrowser,
  appleNative: {
    // Email only: the backend stores no name (data minimisation, HEN-238).
    signInAsync: (hashedNonce) =>
      AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce: hashedNonce }),
    // 32 random bytes from the OS (Hermes has no Web Crypto), as hex.
    createNonce: () => Array.from(Crypto.getRandomBytes(NONCE_BYTES), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    sha256Hex: async (value) => await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  },
};
