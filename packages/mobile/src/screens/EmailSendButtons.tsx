import { AuthButton } from "./AuthButton";

export interface EmailSendButtonsProps {
  readonly ready: boolean;
  readonly hint: string | undefined;
  readonly sending: string | null;
  readonly onSend: (kind: "code" | "link") => void;
}

export function EmailSendButtons({ ready, hint, sending, onSend }: EmailSendButtonsProps) {
  return (
    <>
      <AuthButton
        title="Continue with email"
        looksDisabled={!ready}
        accessibilityHint={hint}
        loading={sending === "code"}
        loadingTitle="Sending code…"
        disabled={sending !== null && sending !== "code"}
        onPress={() => onSend("code")}
      />
      <AuthButton
        title="Email me a sign-in link instead"
        variant="secondary"
        looksDisabled={!ready}
        accessibilityHint={hint}
        loading={sending === "link"}
        loadingTitle="Sending link…"
        disabled={sending !== null && sending !== "link"}
        onPress={() => onSend("link")}
      />
    </>
  );
}
