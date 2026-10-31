import { type ConfigPlugin, withMod } from "expo/config-plugins";

interface StoryboardColour {
  $: Record<string, string>;
}

interface Storyboard {
  document: {
    scenes?: { scene?: { objects?: { viewController?: { view?: { color?: StoryboardColour[] }[] }[] }[] }[] }[];
    resources?: { namedColor?: { $: { name: string }; color: StoryboardColour[] }[] }[];
  };
}

const colourName = "SplashScreenBackground";
const hexColour = /^#[\da-f]{6}$/i;

function channel(hex: string, start: number): string {
  return (Number.parseInt(hex.slice(start, start + 2), 16) / 255).toPrecision(15);
}

function applyBackground(storyboard: Storyboard, hex: string): Storyboard {
  const view = storyboard.document.scenes?.[0]?.scene?.[0]?.objects?.[0]?.viewController?.[0]?.view?.[0];
  const background = view?.color?.find((colour) => colour.$.key === "backgroundColor");
  const resources = storyboard.document.resources?.[0];
  if (!view) {
    throw new Error("SplashScreen.storyboard has no root view");
  }
  if (!background) {
    throw new Error("SplashScreen.storyboard root view has no backgroundColor");
  }
  if (!resources) {
    throw new Error("SplashScreen.storyboard has no resources section");
  }
  background.$ = { key: "backgroundColor", name: colourName };
  const rgb = { red: channel(hex, 1), green: channel(hex, 3), blue: channel(hex, 5) };
  resources.namedColor = [{ $: { name: colourName }, color: [{ $: { alpha: "1.000", ...rgb, customColorSpace: "sRGB", colorSpace: "custom" } }] }];
  return storyboard;
}

const withIosSplashBackground: ConfigPlugin<{ backgroundColor: string }> = (config, { backgroundColor }) => {
  if (!hexColour.test(backgroundColor)) {
    throw new Error(`withIosSplashBackground backgroundColor must be #RRGGBB, got "${backgroundColor}"`);
  }
  return withMod<Storyboard>(config, {
    platform: "ios",
    mod: "splashScreenStoryboard",
    action: (storyboardConfig) => {
      storyboardConfig.modResults = applyBackground(storyboardConfig.modResults, backgroundColor);
      return storyboardConfig;
    },
  });
};

export default withIosSplashBackground;
