import { z } from "zod";

export const identifierSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const videoTimestampMillisecondsSchema = z.int().min(0);

export const styleSchema = z.enum(["gi", "no-gi"]);

export const visibilitySchema = z.enum(["private", "group", "gym"]);

export const positionLabelSchema = z.enum([
  "standing",
  "clinch",
  "closed_guard",
  "half_guard",
  "open_guard",
  "headquarters",
  "side_control",
  "north_south",
  "knee_on_belly",
  "mount",
  "back_control",
  "turtle",
  "front_headlock",
  "crucifix",
  "truck",
  "leg_entanglement",
  "scramble",
  "unknown",
]);
export const eventLabelSchema = z.enum(["takedown", "guard_pull", "guard_pass", "sweep", "back_take", "submission", "escape", "transition", "reset"]);
export const roleSchema = z.enum(["top", "bottom", "neutral"]);

export type Identifier = z.infer<typeof identifierSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type VideoTimestampMilliseconds = z.infer<typeof videoTimestampMillisecondsSchema>;
export type Style = z.infer<typeof styleSchema>;
export type Visibility = z.infer<typeof visibilitySchema>;
export type PositionLabel = z.infer<typeof positionLabelSchema>;
export type EventLabel = z.infer<typeof eventLabelSchema>;
export type Role = z.infer<typeof roleSchema>;
