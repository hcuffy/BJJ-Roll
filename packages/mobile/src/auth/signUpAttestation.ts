import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";

// HEN-183: the sign-up duties the user accepts, with the text version id they accept. The duties, box label and
// refusal message come from @bjj-roll/shared (DRAFT wording until HEN-186); the lines below are the app's own copy.
export { SIGN_UP_ATTESTATION_DUTIES, SIGN_UP_ATTESTATION_LABEL, SIGN_UP_ATTESTATION_REFUSAL_MESSAGE } from "@bjj-roll/shared";
/** Muted line under the duties: names the text version the tick accepts. */
export const ATTESTATION_VERSION_NOTE = `Text version: ${SIGN_UP_ATTESTATION_TEXT_VERSION.id}`;
/** Hint for the dimmed send buttons while only the duties box is missing. */
export const ATTESTATION_NEEDED_HINT = "Tick I accept these duties first.";
/** Second line of the link error card after an attestation refusal. */
export const ATTESTATION_LINK_REFUSAL_NEXT_STEP = "Tick I accept these duties and send a new link.";
/** The prompt shown after sign-in when the account has not accepted the current text version. */
export const ATTESTATION_PROMPT_TITLE = "Accept the sign-up duties";
export const ATTESTATION_PROMPT_BODY = "To keep using BJJ Roll, accept these duties.";
export const ATTESTATION_PROMPT_ACCEPT = "Accept and continue";
/** Draft copy (Vera #74 item 4); the final duty text comes from the lawyer (HEN-189). */
export const ATTESTATION_LEAD = "Before you upload, you agree to:";
export const ATTESTATION_SAVING = "Saving…";
