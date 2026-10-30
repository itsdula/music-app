export type {
  AssistantErrorCode,
  AssistantMessage,
  AssistantRequest,
  AssistantResponse,
  AssistantToolCall,
  AssistantToolDefinition,
  AssistantTransport,
  JsonSchema,
} from '@studio/platform-contracts';
export {
  ASSISTANT_ERROR_CODES,
  AssistantError,
  captureAssistantResult,
  isAssistantError,
  isAssistantErrorCode,
  safeProviderMessage,
  toAssistantFailure,
  unwrapAssistantResult,
  type AssistantFailure,
  type AssistantResult,
} from './errors';
export {
  DEFAULT_ASSISTANT_LIMITS,
  resolveAssistantLimits,
  validateAssistantRequest,
  type AssistantLimits,
  type AssistantValidation,
} from './guards';
export {
  fromChatCompletionsBody,
  toChatCompletionsBody,
  type ChatCompletionsBody,
} from './mapping';
export {
  chatCompletionsUrl,
  createOpenAiCompatibleClient,
  type AbortSignalLike,
  type FetchLike,
  type FetchLikeInit,
  type FetchLikeResponse,
  type OpenAiCompatibleClientOptions,
} from './client';
export {
  ASSISTANT_PROVIDER_PRESETS,
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_BASE_URL,
  createAssistantClient,
  createOpenRouterClient,
  type AssistantProviderConfig,
  type AssistantProviderId,
  type AssistantProviderPreset,
  type OpenRouterClientOptions,
} from './presets';
