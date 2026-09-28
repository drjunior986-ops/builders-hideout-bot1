import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type EventConfig = {
  channelId: string;
  title: string;
  message: string;
  color: number;
};

export type WarningRecord = {
  id: string;
  moderatorId: string;
  reason: string;
  timestamp: string;
};

export const AUTOMOD_FEATURES = [
  "spam",
  "flood",
  "duplicates",
  "mentions",
  "invites",
  "blockedwords",
  "characters",
] as const;

export type AutoModFeature = (typeof AUTOMOD_FEATURES)[number];
export type AutoModAction = "warn" | "timeout";

export type AutoModConfig = {
  enabled: Record<AutoModFeature, boolean>;
  actions: Record<AutoModFeature, AutoModAction>;
  spamLimit: number;
  spamWindowSeconds: number;
  floodLimit: number;
  floodWindowSeconds: number;
  duplicateLimit: number;
  duplicateWindowSeconds: number;
  mentionLimit: number;
  repeatedCharacterThreshold: number;
  timeoutMinutes: number;
  cooldownSeconds: number;
  inviteChannelIds: string[];
  blockedWords: string[];
};

export type GiveawayStatus = "active" | "paused" | "ended";

export type GiveawayRecord = {
  id: string;
  guildId: string;
  messageId: string;
  channelId: string;
  organizerId: string;
  prize: string;
  description?: string;
  embedColor?: number;
  durationMs: number;
  numberOfWinners: number;
  requiredRoleId?: string;
  participants: string[];
  winners: string[];
  winnerHistory: string[];
  status: GiveawayStatus;
  endAt: string;
  createdAt: string;
  endedAt?: string;
  pausedAt?: string;
  remainingMs?: number;
};

export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "closed" | "deleted";

export type TicketQuestion = {
  id: string;
  label: string;
  required: boolean;
  maxLength: number;
  order: number;
  paragraph?: boolean;
};

export type TicketTypeConfig = {
  key: string;
  name: string;
  description: string;
  emoji?: string;
  categoryId?: string;
  staffRoleIds: string[];
  questions: TicketQuestion[];
  preventDuplicate: boolean;
  channelNameTemplate?: string;
};

export type TicketPanelConfig = {
  id: string;
  channelId: string;
  messageId: string;
  title: string;
  description: string;
  createdAt: string;
};

export type TicketCloseRecord = {
  reason: string;
  closedBy: string;
  closedAt: string;
  automatic: boolean;
};

export type TicketEvent = {
  type: string;
  actorId?: string;
  details?: string;
  timestamp: string;
};

export type TicketRecord = {
  id: string;
  guildId: string;
  channelId: string;
  panelId: string;
  typeKey: string;
  typeName: string;
  creatorId: string;
  staffRoleIds: string[];
  questionAnswers: Record<string, string>;
  addedUserIds: string[];
  priority: TicketPriority;
  claimantId?: string;
  status: TicketStatus;
  createdAt: string;
  lastActivityAt: string;
  warningSentAt?: string;
  inactivityWarningAt?: string;
  closedAt?: string;
  closedBy?: string;
  closeReason?: string;
  closeHistory: TicketCloseRecord[];
  events: TicketEvent[];
  deletedAt?: string;
};
export type PaymentStatus =
  | "waiting"
  | "verified"
  | "unavailable"
  | "cancelled"
  | "manual_verified"
  | "rejected";

export type PaymentRecord = {
  id: string;
  guildId: string;
  sellerId: string;
  buyerId: string;
  sellerMinecraft?: string;
  buyerMinecraft?: string;
  amount: string;
  service: string;
  paymentType: string;
  status: PaymentStatus;
  createdAt: string;
  verifiedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  verificationSource?: string;
  transactionId?: string;
  transactionData?: Record<string, unknown>;
  reviewBy?: string;
  reviewReason?: string;
};

export type PaymentConfig = {
  payments: Record<string, PaymentRecord>;
  profiles: Record<string, string>;
  logChannelId?: string;
};
export type TicketConfig = {
  panels: Record<string, TicketPanelConfig>;
  types: Record<string, TicketTypeConfig>;
  tickets: Record<string, TicketRecord>;
  logsChannelId?: string;
  inactivityHours: number;
  warningHours: number;
};

export type GuildConfig = {
  welcome?: EventConfig;
  leave?: EventConfig;
  logsChannelId?: string;
  warnings?: Record<string, WarningRecord[]>;
  automod?: Partial<AutoModConfig>;
  giveaways?: Record<string, GiveawayRecord>;
  tickets?: Partial<TicketConfig>;
  payments?: Partial<PaymentConfig>;
};

type ConfigMap = Record<string, GuildConfig>;

const configPath = resolve(dirname(fileURLToPath(import.meta.url)), "../data/config.json");

const emptyConfig = (): ConfigMap => ({});

export function createDefaultAutoModConfig(): AutoModConfig {
  return {
    enabled: {
      spam: false,
      flood: false,
      duplicates: false,
      mentions: false,
      invites: false,
      blockedwords: false,
      characters: false,
    },
    actions: {
      spam: "warn",
      flood: "warn",
      duplicates: "warn",
      mentions: "warn",
      invites: "warn",
      blockedwords: "warn",
      characters: "warn",
    },
    spamLimit: 5,
    spamWindowSeconds: 8,
    floodLimit: 10,
    floodWindowSeconds: 5,
    duplicateLimit: 3,
    duplicateWindowSeconds: 30,
    mentionLimit: 5,
    repeatedCharacterThreshold: 12,
    timeoutMinutes: 10,
    cooldownSeconds: 30,
    inviteChannelIds: [],
    blockedWords: [],
  };
}

export class ConfigStore {
  private readonly configs: ConfigMap;

  constructor() {
    this.configs = this.read();
  }

  get(guildId: string): GuildConfig {
    return this.configs[guildId] ?? {};
  }

  getAutoModConfig(guildId: string): AutoModConfig {
    const stored = this.configs[guildId]?.automod;
    const defaults = createDefaultAutoModConfig();

    return {
      ...defaults,
      ...stored,
      enabled: { ...defaults.enabled, ...stored?.enabled },
      actions: { ...defaults.actions, ...stored?.actions },
      inviteChannelIds: [...(stored?.inviteChannelIds ?? defaults.inviteChannelIds)],
      blockedWords: [...(stored?.blockedWords ?? defaults.blockedWords)],
    };
  }

  setAutoModConfig(guildId: string, autoModConfig: AutoModConfig): void {
    this.configs[guildId] ??= {};
    this.configs[guildId].automod = autoModConfig;
    this.write();
  }

  updateAutoModConfig(
    guildId: string,
    update: (config: AutoModConfig) => void,
  ): AutoModConfig {
    const config = this.getAutoModConfig(guildId);
    update(config);
    this.setAutoModConfig(guildId, config);
    return config;
  }

  addInviteChannel(guildId: string, channelId: string): boolean {
    const config = this.getAutoModConfig(guildId);
    if (config.inviteChannelIds.includes(channelId)) {
      return false;
    }

    config.inviteChannelIds.push(channelId);
    this.setAutoModConfig(guildId, config);
    return true;
  }

  removeInviteChannel(guildId: string, channelId: string): boolean {
    const config = this.getAutoModConfig(guildId);
    const originalLength = config.inviteChannelIds.length;
    config.inviteChannelIds = config.inviteChannelIds.filter(
      (id) => id !== channelId,
    );

    if (config.inviteChannelIds.length === originalLength) {
      return false;
    }

    this.setAutoModConfig(guildId, config);
    return true;
  }

  addBlockedWord(guildId: string, word: string): boolean {
    const config = this.getAutoModConfig(guildId);
    if (config.blockedWords.includes(word)) {
      return false;
    }

    config.blockedWords.push(word);
    this.setAutoModConfig(guildId, config);
    return true;
  }

  removeBlockedWord(guildId: string, word: string): boolean {
    const config = this.getAutoModConfig(guildId);
    const originalLength = config.blockedWords.length;
    config.blockedWords = config.blockedWords.filter((value) => value !== word);

    if (config.blockedWords.length === originalLength) {
      return false;
    }

    this.setAutoModConfig(guildId, config);
    return true;
  }

  addWarning(
    guildId: string,
    userId: string,
    warning: Omit<WarningRecord, "id" | "timestamp">,
  ): WarningRecord {
    this.configs[guildId] ??= {};
    this.configs[guildId].warnings ??= {};
    this.configs[guildId].warnings[userId] ??= [];

    const record: WarningRecord = {
      ...warning,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.configs[guildId].warnings[userId].push(record);
    this.write();
    return record;
  }

  getWarnings(guildId: string, userId: string): WarningRecord[] {
    return [...(this.configs[guildId]?.warnings?.[userId] ?? [])];
  }

  clearWarnings(guildId: string, userId: string): WarningRecord[] {
    const warnings = this.getWarnings(guildId, userId);
    if (this.configs[guildId]?.warnings) {
      delete this.configs[guildId].warnings[userId];
      this.write();
    }
    return warnings;
  }

  getGiveaway(guildId: string, giveawayId: string): GiveawayRecord | null {
    const giveaway = this.configs[guildId]?.giveaways?.[giveawayId];
    return giveaway ? cloneGiveaway(giveaway) : null;
  }

  getGiveaways(guildId: string): GiveawayRecord[] {
    return Object.values(this.configs[guildId]?.giveaways ?? {}).map(cloneGiveaway);
  }

  getAllGiveaways(): GiveawayRecord[] {
    return Object.values(this.configs).flatMap((config) =>
      Object.values(config.giveaways ?? {}).map(cloneGiveaway),
    );
  }

  setGiveaway(giveaway: GiveawayRecord): void {
    const config = this.configs[giveaway.guildId] ??= {};
    config.giveaways ??= {};
    config.giveaways[giveaway.id] = cloneGiveaway(giveaway);
    this.write();
  }

  updateGiveaway(
    guildId: string,
    giveawayId: string,
    update: (giveaway: GiveawayRecord) => void,
  ): GiveawayRecord | null {
    const giveaway = this.configs[guildId]?.giveaways?.[giveawayId];
    if (!giveaway) {
      return null;
    }

    update(giveaway);
    this.write();
    return cloneGiveaway(giveaway);
  }

  getTicketConfig(guildId: string): TicketConfig {
    const stored = this.configs[guildId]?.tickets;
    return {
      panels: { ...(stored?.panels ?? {}) },
      types: { ...(stored?.types ?? {}) },
      tickets: { ...(stored?.tickets ?? {}) },
      logsChannelId: stored?.logsChannelId,
      inactivityHours: stored?.inactivityHours ?? 48,
      warningHours: stored?.warningHours ?? 24,
    };
  }

  setTicketConfig(guildId: string, ticketConfig: TicketConfig): void {
    this.configs[guildId] ??= {};
    this.configs[guildId].tickets = ticketConfig;
    this.write();
  }

  updateTicketConfig(
    guildId: string,
    update: (config: TicketConfig) => void,
  ): TicketConfig {
    const config = this.getTicketConfig(guildId);
    update(config);
    this.setTicketConfig(guildId, config);
    return config;
  }

  getAllTicketRecords(): TicketRecord[] {
    return Object.values(this.configs).flatMap((config) =>
      Object.values(config.tickets?.tickets ?? {}),
    );
  }
  getPaymentConfig(guildId: string): PaymentConfig {
    const stored = this.configs[guildId]?.payments;

    return {
      payments: { ...(stored?.payments ?? {}) },
      profiles: { ...(stored?.profiles ?? {}) },
      logChannelId: stored?.logChannelId,
    };
  }

  setPaymentConfig(
    guildId: string,
    paymentConfig: PaymentConfig,
  ): void {
    this.configs[guildId] ??= {};
    this.configs[guildId].payments = paymentConfig;
    this.write();
  }

  getPayment(
    guildId: string,
    paymentId: string,
  ): PaymentRecord | null {
    const payment =
      this.configs[guildId]?.payments?.payments?.[paymentId];

    return payment ? { ...payment } : null;
  }

  getPayments(guildId: string): PaymentRecord[] {
    return Object.values(
      this.configs[guildId]?.payments?.payments ?? {},
    );
  }

  setPayment(payment: PaymentRecord): void {
    const config = this.getPaymentConfig(payment.guildId);

    config.payments[payment.id] = { ...payment };

    this.setPaymentConfig(payment.guildId, config);
  }

  updatePayment(
    guildId: string,
    paymentId: string,
    update: (payment: PaymentRecord) => void,
  ): PaymentRecord | null {
    const config = this.getPaymentConfig(guildId);
    const payment = config.payments[paymentId];

    if (!payment) {
      return null;
    }

    update(payment);

    config.payments[paymentId] = payment;

    this.setPaymentConfig(guildId, config);

    return { ...payment };
  }

  setMinecraftProfile(
    guildId: string,
    discordUserId: string,
    minecraftUsername: string,
  ): void {
    const config = this.getPaymentConfig(guildId);

    config.profiles[discordUserId] = minecraftUsername;

    this.setPaymentConfig(guildId, config);
  }

  getMinecraftProfile(
    guildId: string,
    discordUserId: string,
  ): string | null {
    return (
      this.configs[guildId]?.payments?.profiles?.[discordUserId] ??
      null
    );
  }

  removeMinecraftProfile(
    guildId: string,
    discordUserId: string,
  ): boolean {
    const config = this.getPaymentConfig(guildId);

    if (!config.profiles[discordUserId]) {
      return false;
    }

    delete config.profiles[discordUserId];

    this.setPaymentConfig(guildId, config);

    return true;
  }
  
  setEventConfig(
    guildId: string,
    event: "welcome" | "leave",
    eventConfig: EventConfig,
  ): void {
    this.configs[guildId] ??= {};
    this.configs[guildId][event] = eventConfig;
    this.write();
  }

  setLogsChannel(guildId: string, channelId: string): void {
    this.configs[guildId] ??= {};
    this.configs[guildId].logsChannelId = channelId;
    this.write();
  }

  private read(): ConfigMap {
    if (!existsSync(configPath)) {
      return emptyConfig();
    }

    const raw = readFileSync(configPath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Discord bot configuration must be a JSON object.");
    }

    return parsed as ConfigMap;
  }

  private write(): void {
    const directory = dirname(configPath);
    mkdirSync(directory, { recursive: true });

    const temporaryPath = `${configPath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.configs, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, configPath);
  }
}

function cloneGiveaway(giveaway: GiveawayRecord): GiveawayRecord {
  return {
    ...giveaway,
    description: giveaway.description,
    participants: [...giveaway.participants],
    winners: [...giveaway.winners],
    winnerHistory: [...(giveaway.winnerHistory ?? giveaway.winners)],
  };
}