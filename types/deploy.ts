export interface DeployedContracts {
    [name: string]: {
        address: string;
        isLib?: boolean;
        gasUsed?: number;
    };
}

export interface Deployments {
    meta: {
        created: number;
    };
    contracts: DeployedContracts;
}
