export {
  EmailSendError,
  renderMagicLinkEmail,
  renderOneTimeCodeEmail,
  type EmailSender,
  type EmailSendFailureReason,
  type RenderedEmailMessage,
  type SendMagicLinkInput,
  type SendOneTimeCodeInput,
} from "./emailSender.js";
export { FakeEmailSender, type FakeSentEmailMessage, type FakeSentMagicLinkMessage, type FakeSentOneTimeCodeMessage } from "./fakeEmailSender.js";
export {
  DEFAULT_LETTERMINT_ENDPOINT,
  DEFAULT_LETTERMINT_TIMEOUT_MILLISECONDS,
  LettermintEmailSender,
  type FetchFunction,
  type LettermintEmailSenderConfig,
  type LettermintSendRequestBody,
} from "./lettermintEmailSender.js";
