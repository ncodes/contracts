import * as dotenv from "dotenv";
import {BigNumber} from "ethers";
import * as path from "path";
import {toBN} from "../utils/utils";

export enum Network {
    Ethereum = "ethereum",
    Goerli = "goerli",
    Sepolia = "sepolia",
    Localhost = "localhost",
    Hardhat = "hardhat",
}

interface ContractParams {
    // Order Core Params
    minTimeToPay: number;
    orderGraceDur: number;
    maxOpenOrders: number;
    maxOpenDisputes: number;
    transferToFeePoolInterval: number;

    // Market Core Params
    defaultDisputeDelayDur: number;

    // Mediator Manager Params
    baseTicketPrice: BigNumber;
    ticketWindowDur: number;
    ticketsPerWindow: number;
    ticketSupply: number;
    priceSupplyDeltaBP: number;
    minInactiveWindowBeforeReset: number;
    soldOutBP: number;
    ticketMatureDur: number;
    ticketCancelDur: number;
    ticketExpireDur: number;
    ticketPauseDur: number;
    poolReqBond: BigNumber;
    poolDraftReward: BigNumber;
    poolWinReward: BigNumber;
    poolNumDraftee: number;
    poolNoVoteSlashBP: number;
    poolLoseVoteSlashBP: number;
    poolEvidenceDur: number;
    poolPredictDur: number;

    // Dispute Manager Params
    evidenceDur: number;
    predictDur: number;

    // Miner Registry Params
    minerBond: BigNumber;
    minerMatureDur: number;
    minerCancelDur: number;

    // Chainlink Params
    chainlinkKeyHash: string;
    chainlinkCoordinator: string;
    chainlinkSubId: number;

    // Deployer Params
    safe: string;
    allocatorAddr: string;
    instructionBadgeIssuer: string;
    paymentMethodBadgeIssuerKey: string;
    kycBadgeIssuerKey: string;

    // Operator Params
    operatorBond: BigNumber;
}

export function getParams(net: Network) {
    dotenv.config({path: path.join(__dirname, `${net}/.env`)});
    dotenv.config({path: path.join(__dirname, `${net}/.env.local`)});

    function toInt(val: string | undefined) {
        return parseInt(val as string);
    }

    return <ContractParams>{
        minTimeToPay: toInt(process.env.OC_MIN_TIME_TO_PAY),
        orderGraceDur: toInt(process.env.OC_ORDER_GRACE_DUR),
        maxOpenOrders: toInt(process.env.OC_MAX_OPEN_ORDERS),
        maxOpenDisputes: toInt(process.env.OC_MAX_OPEN_DISPUTES),
        transferToFeePoolInterval: toInt(process.env.OC_TRANSFER_TO_FEE_POOL_INTERVAL),

        defaultDisputeDelayDur: toInt(process.env.MC_DEFAULT_DISPUTE_DELAY_DUR),

        baseTicketPrice: toBN(process.env.MM_BASE_TICKET_PRICE),
        ticketWindowDur: toInt(process.env.MM_TICKET_WINDOW_DUR),
        ticketsPerWindow: toInt(process.env.MM_TICKETS_PER_WINDOW),
        ticketSupply: toInt(process.env.MM_TICKET_SUPPLY),
        priceSupplyDeltaBP: toInt(process.env.MM_PRICE_SUPPLY_DELTA_BP),
        minInactiveWindowBeforeReset: toInt(process.env.MM_MIN_INACTIVE_WINDOW_BEFORE_RESET),
        soldOutBP: toInt(process.env.MM_SOLD_OUT_BP),
        ticketMatureDur: toInt(process.env.MM_TICKET_MATURE_DUR),
        ticketCancelDur: toInt(process.env.MM_TICKET_CANCEL_DUR),
        ticketExpireDur: toInt(process.env.MM_TICKET_EXPIRE_DUR),
        ticketPauseDur: toInt(process.env.MM_TICKET_PAUSE_DUR),
        poolReqBond: toBN(process.env.MM_POOL_REQ_BOND),
        poolDraftReward: toBN(process.env.MM_POOL_DRAFT_REWARD),
        poolWinReward: toBN(process.env.MM_POOL_WIN_REWARD),
        poolNumDraftee: toInt(process.env.MM_POOL_NUM_DRAFTEE),
        poolNoVoteSlashBP: toInt(process.env.MM_POOL_NO_VOTE_SLASH_BP),
        poolLoseVoteSlashBP: toInt(process.env.MM_POOL_LOSE_VOTE_SLASH_BP),
        poolEvidenceDur: toInt(process.env.MM_POOL_EVIDENCE_DUR),
        poolPredictDur: toInt(process.env.MM_POOL_PREDICT_DUR),

        evidenceDur: toInt(process.env.DM_EVIDENCE_DUR),
        predictDur: toInt(process.env.DM_PREDICT_DUR),

        minerBond: toBN(process.env.MR_MINER_BOND),
        minerMatureDur: toInt(process.env.MR_MATURE_DUR),
        minerCancelDur: toInt(process.env.MR_CANCEL_DUR),

        chainlinkKeyHash: process.env.KEY_HASH as string,
        chainlinkCoordinator: process.env.COORDINATOR as string,
        chainlinkSubId: toInt(process.env.SUB_ID),

        safe: process.env.SAFE,
        allocatorAddr: process.env.ALLOCATOR_ADDR,
        instructionBadgeIssuer: process.env.INSTRUCTION_BADGE_ISSUER,
        paymentMethodBadgeIssuerKey: process.env.PAYMENT_METHOD_BADGE_ISSUER_KEY,
        kycBadgeIssuerKey: process.env.KYC_BADGE_ISSUER_KEY,

        operatorBond: toBN(process.env.OP_OPERATOR_BOND),
    };
}
