import { Text, View } from "react-native";
import { textStyles } from "../theme/tokens";
import { type LinkErrorCardProps, LinkErrorCard } from "./LinkErrorCard";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface SignInHeaderProps {
  readonly linkError: string | null;
  readonly linkErrorReason: LinkErrorCardProps["reason"];
  readonly accountNotice: string | null;
}

export function SignInHeader({ linkError, linkErrorReason, accountNotice }: SignInHeaderProps) {
  return (
    <>
      {linkError ? <LinkErrorCard message={linkError} reason={linkErrorReason} /> : null}
      {accountNotice ? (
        <View style={authStyles.card}>
          <StatusText message={accountNotice} style={authStyles.notice} />
        </View>
      ) : null}
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          Sign in to BJJ Roll
        </Text>
        <Text style={textStyles.bodyMuted}>New here? We&apos;ll create your account.</Text>
      </View>
    </>
  );
}
