export enum ContractNames {
    BadgeManager = "BadgeManager",
    TOKEN = "TOKEN",
    MarketCore = "MarketCore",
    MarketAuxLib = "MarketAuxLib",
    AuxLib = "AuxLib",
    LiquidityLib = "LiquidityLib",
    OrderLib = "OrderLib",
    FeeLib = "FeeLib",
    OrderReleaseLib = "OrderReleaseLib",
    SwapNonFungibleLib = "SwapNonFungibleLib",
    SwapFungibleLib = "SwapFungibleLib",
    SwapLib = "SwapLib",
    WithdrawLib = "WithdrawLib",
    OfferLib = "OfferLib",
    FungibleLiquidityLib = "FungibleLiquidityLib",
    NonFungibleLiquidityLib = "NonFungibleLiquidityLib",
    Core = "Core",
    AssetRegistry = "AssetRegistry",
    MinerRegistry = "MinerRegistry",
    Operator = "Operator",
    FeePurse = "FeePurse",
    DummyRandomness = "DummyRandomness",
    MediatorManager = "MediatorManager",
    DisputeManager = "DisputeManager",
    NFT = "NFT",
    ENERGON = "ENERGON",
    WETH9 = "WETH9",
    UNI = "UNI",
    NGN = "NGN",
    BondCurveDistro = "BondCurveDistro",
}

export type DeployedContracts = Record<string, ContractInfo>;

export interface Deployments {
    meta: {created: number};
    contracts: Record<string, ContractInfo>;
}

interface ContractInfo {
    isLib?: boolean;
    address: string;
    gasUsed: number;
}
