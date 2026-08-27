import {
  getAiConfig,
  getAnthropicClient,
  isAiConfigured,
} from './provider';

export function aiConfigured(): boolean {
  return isAiConfigured();
}

export function coachModel(): string {
  return getAiConfig().models.coach;
}

export function chatModel(): string {
  return getAiConfig().models.chat;
}

export function judgeModel(): string {
  return getAiConfig().models.judge;
}

export function voiceModel(): string {
  return getAiConfig().models.voice;
}

export function briefModel(): string {
  return getAiConfig().models.brief;
}

export function anthropic() {
  return getAnthropicClient();
}
