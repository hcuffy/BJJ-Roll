import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { appAuthClient, appBackendUrl } from "./appAuthClient";
import { readSocialSignInConfig, visibleSocialProviders, type SocialSignInDependencies } from "./socialSignIn";

const NONCE_BYTES = 32;

export const appSocialProviders = visibleSocialProviders(readSocialSignInConfig(Constants.expoConfig), Platform.OS);

export const appSocialSignIn: SocialSignInDependencies = {
  client: appAuthClient,
  backendUrl: appBackendUrl,
  platform: Platform.OS,
  browser: WebBrowser,
  appleNative: {
    signInAsync: (hashedNonce) =>
      AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce: hashedNonce }),
    createNonce: () => Array.from(Crypto.getRandomBytes(NONCE_BYTES), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    sha256Hex: async (value) => await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  },
};
