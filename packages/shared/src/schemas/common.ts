import { z } from "zod";

// ARCHITECTURE.md §2.1: common building blocks.
export const identifierSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const videoTimestampMillisecondsSchema = z.int().min(0);

// H9: every video is gi or no-gi.
export const styleSchema = z.enum(["gi", "no-gi"]);

// Only "private" is live until M6 (group) and M7 (gym). See §4.
export const visibilitySchema = z.enum(["private", "group", "gym"]);

// HEN-44 label set v1: level 1 ids (Henry approved the level 1 size, 2026-10-17). Level 2 details are a pick list per label.
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
