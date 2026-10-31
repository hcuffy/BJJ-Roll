import type { ExportedConfig, ExportedConfigWithProps, Mod } from "expo/config-plugins";
import { describe, expect, it } from "vitest";
import withIosSplashBackground from "../../plugins/withIosSplashBackground";
import { colours } from "../theme/tokens";

const systemBackground = { $: { key: "backgroundColor", systemColor: "systemBackgroundColor" } };

function storyboardWith(view: object | undefined, resources: object[] | undefined): object {
  return { document: { scenes: [{ scene: [{ objects: [{ viewController: [{ view: view ? [view] : [] }] }] }] }], resources } };
}

async function applyPluginToStoryboard(storyboard: object, backgroundColor: string): Promise<unknown> {
  const config: ExportedConfig = withIosSplashBackground({ name: "BJJ Roll", slug: "bjj-roll" }, { backgroundColor });
  const applyStoryboard = (config.mods?.ios as Record<string, Mod<object>>).splashScreenStoryboard;
  const storyboardRequest = { ...config, modResults: storyboard, modRequest: { nextMod: (next: unknown) => next } };
  return await applyStoryboard?.(storyboardRequest as ExportedConfigWithProps<object>);
}

describe("iOS launch screen plugin refuses to fall back to the system colour (HEN-357)", () => {
  it("throws, naming the missing part, when the storyboard has no root view, no background colour or no resources", async () => {
    await expect(applyPluginToStoryboard(storyboardWith(undefined, [{}]), colours.background)).rejects.toThrow(
      "SplashScreen.storyboard has no root view",
    );
    await expect(applyPluginToStoryboard(storyboardWith({ color: [] }, [{}]), colours.background)).rejects.toThrow(
      "SplashScreen.storyboard root view has no backgroundColor",
    );
    await expect(applyPluginToStoryboard(storyboardWith({ color: [systemBackground] }, undefined), colours.background)).rejects.toThrow(
      "SplashScreen.storyboard has no resources section",
    );
  });

  it("throws unless backgroundColor is #RRGGBB", () => {
    for (const backgroundColor of ["#111", "111313", "#11131", "#1113131", "#GG1313", "rgb(17, 19, 19)"]) {
      expect(() => withIosSplashBackground({ name: "BJJ Roll", slug: "bjj-roll" }, { backgroundColor })).toThrow(
        `withIosSplashBackground backgroundColor must be #RRGGBB, got "${backgroundColor}"`,
      );
    }
    expect(() => withIosSplashBackground({ name: "BJJ Roll", slug: "bjj-roll" }, { backgroundColor: colours.background })).not.toThrow();
  });

  it("keeps the root view's other colours and points only backgroundColor at SplashScreenBackground #111313", async () => {
    const tintColour = { $: { key: "tintColor", systemColor: "systemBlueColor" } };
    const storyboard = storyboardWith({ color: [{ $: { ...tintColour.$ } }, systemBackground] }, [{}]);
    const result = (await applyPluginToStoryboard(storyboard, colours.background)) as { modResults: typeof storyboard };
    const { document } = result.modResults as {
      document: {
        scenes: { scene: { objects: { viewController: { view: { color: object[] }[] }[] }[] }[] }[];
        resources: { namedColor: { $: object; color: { $: object }[] }[] }[];
      };
    };
    expect(document.scenes[0]?.scene[0]?.objects[0]?.viewController[0]?.view[0]?.color).toEqual([
      tintColour,
      { $: { key: "backgroundColor", name: "SplashScreenBackground" } },
    ]);
    expect(document.resources[0]?.namedColor).toEqual([
      {
        $: { name: "SplashScreenBackground" },
        color: [
          {
            $: {
              alpha: "1.000",
              red: "0.0666666666666667",
              green: "0.0745098039215686",
              blue: "0.0745098039215686",
              customColorSpace: "sRGB",
              colorSpace: "custom",
            },
          },
        ],
      },
    ]);
  });
});
