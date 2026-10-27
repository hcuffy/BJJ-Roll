/** Metro turns an image import into an asset id (and picks @2x/@3x by screen density); Vitest turns it into a path. */
declare module "*.png" {
  import type { ImageSourcePropType } from "react-native";

  const source: ImageSourcePropType;
  export default source;
}
