export const fetchedAt = "2026-07-19T08:30:00.000Z";

export const currentHealth = {
  status: "ok",
  version: "0.43.0",
};

export const currentUsage = [
  {
    provider: "codex",
    account: "private@example.invalid",
    source: "web",
    version: "0.43.0",
    usage: {
      primary: {
        usedPercent: 64,
        windowMinutes: 300,
        resetsAt: "2026-07-19T10:00:00.000Z",
        resetDescription: "in 90 minutes",
      },
      secondary: {
        usedPercent: 28,
        windowMinutes: 10080,
        resetsAt: "2026-07-25T00:00:00.000Z",
      },
      updatedAt: "2026-07-19T08:29:30.000Z",
      accountEmail: "private@example.invalid",
      accountOrganization: "Secret Studio",
    },
    pace: {
      primary: {
        stage: "steady",
        deltaPercent: -8,
        expectedUsedPercent: 72,
        willLastToReset: true,
        etaSeconds: null,
        summary: "On pace",
      },
      secondary: null,
    },
  },
];

export const currentCost = [
  {
    provider: "codex",
    source: "local",
    updatedAt: "2026-07-19T08:29:00.000Z",
    currencyCode: "USD",
    sessionCostUSD: 1.25,
    last30DaysCostUSD: 42.5,
    projects: [
      {
        name: "private-project",
        path: "/Users/example/private-project",
      },
    ],
  },
];

export const detailedCodexCost = [
  {
    provider: "codex",
    source: "local",
    updatedAt: "2026-07-19T08:30:50.000Z",
    currencyCode: "USD",
    sessionCostUSD: 2.75,
    sessionTokens: 12_233_096,
    historyDays: 30,
    last30DaysTokens: 2_750_469_967,
    last30DaysCostUSD: 1_855.16,
    daily: [
      {
        date: "2026-07-18",
        totalTokens: 18_000_000,
        totalCost: 11.25,
        modelBreakdowns: [
          { modelName: "gpt-5.5", totalTokens: 12_000_000, cost: 8.25 },
          { modelName: "gpt-5.6-sol", totalTokens: 6_000_000, cost: 3 },
        ],
      },
      {
        date: "2026-07-19",
        totalTokens: 12_233_096,
        totalCost: 9.74,
        modelBreakdowns: [
          { modelName: "gpt-5.6-sol", totalTokens: 10_000_000, cost: 8 },
          {
            modelName: "private@example.invalid-/Users/alice/Secret Project",
            totalTokens: 99_000_000,
          },
        ],
      },
    ],
    projects: [{ name: "private-project", path: "/Users/alice/Secret Project" }],
  },
];

export const detailedCodexUsage = [
  {
    provider: "codex",
    usage: {
      codexResetCredits: {
        availableCount: 3,
        updatedAt: "2026-07-19T08:30:55.000Z",
        credits: [
          {
            id: "private-credit-id-1",
            status: "available",
            expires_at: "2026-07-31T20:00:30.000Z",
            title: "Private reset credit",
          },
          {
            id: "private-credit-id-2",
            status: "available",
            expires_at: "2026-08-12T17:36:39.000Z",
            description: "Private reset credit description",
          },
          {
            id: "expired-credit-id",
            status: "available",
            expires_at: "2026-07-18T17:36:39.000Z",
          },
        ],
      },
    },
  },
];

export const mixedProviderUsage = [
  {
    provider: "claude",
    source: "web",
    usage: {
      primary: {
        usedPercent: 0,
        windowMinutes: 300,
        resetsAt: null,
        isSyntheticPlaceholder: true,
      },
      secondary: {
        usedPercent: 87,
        windowMinutes: 10080,
        resetsAt: "2026-07-22T00:00:00.000Z",
      },
      tertiary: null,
      updatedAt: "2026-07-19T08:28:00.000Z",
    },
  },
  {
    provider: "zai",
    source: "api",
    usage: {
      primary: {
        usedPercent: 55,
        windowMinutes: 43200,
        resetsAt: "2026-08-01T00:00:00.000Z",
        resetDescription: "30 days window",
      },
      secondary: {
        usedPercent: 10,
        windowMinutes: null,
        resetsAt: "2026-08-01T00:00:00.000Z",
        resetDescription: "Monthly",
      },
      tertiary: {
        usedPercent: 80,
        windowMinutes: 300,
        resetsAt: "2026-07-19T11:00:00.000Z",
      },
      updatedAt: "2026-07-19T08:27:00.000Z",
    },
  },
  {
    provider: "gemini",
    source: "oauth",
    usage: null,
    error: {
      code: 401,
      kind: "unauthorized",
      message: "Account private@example.invalid needs attention",
    },
  },
];

export const dashboardV1Snapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-19T08:31:00.000Z",
  staleAfterSeconds: 180,
  host: {
    codexBarVersion: "0.45.1",
    refreshIntervalSeconds: 60,
  },
  providers: [
    {
      id: "codex",
      name: "Codex",
      enabled: true,
      source: "oauth",
      status: {
        level: "ok",
        label: "Operational",
        updatedAt: "2026-07-19T08:30:45.000Z",
      },
      identity: {
        accountEmail: "redacted@example.invalid",
        plan: "Pro",
      },
      windows: [
        {
          kind: "session",
          label: "Session",
          usedPercent: 25,
          remainingPercent: 75,
          resetAt: "2026-07-19T12:00:00.000Z",
        },
      ],
      credits: {
        remaining: 0,
        unit: "credits",
      },
      cost: {
        todayUSD: 2.5,
        last30DaysUSD: 31,
      },
      display: {
        accentColor: "#49A3B0",
        sortKey: 0,
        priority: "normal",
      },
      error: null,
      updatedAt: "2026-07-19T08:30:30.000Z",
    },
  ],
};
