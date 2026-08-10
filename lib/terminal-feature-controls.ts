type TerminalFeatureEnvironment = Record<string, string | undefined>;

export interface PublicTerminalFeatures {
  railFundingEnabled: boolean;
}

export function getPublicTerminalFeatures(
  environment: TerminalFeatureEnvironment = process.env,
): PublicTerminalFeatures {
  return {
    railFundingEnabled: environment.HEDGENTS_RAIL_FUNDING_ENABLED === "true",
  };
}
