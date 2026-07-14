// Covenant — deployed contract addresses on GenLayer Studio Network.
// Chain ID 61999 (hex 0xF22F).

export const MONITOR_CONTRACT_ADDRESS =
  "0x906Dd97DEd78B3B9FB198a5227A831b70f8b1180";

export const VAULT_CONTRACT_ADDRESS =
  "0xd0cED4dd1Fb3605686d057c883A4DDd1bE81b71d";

// The deployer wallet. On v2 it holds NO contract authority: it is only the
// protocol fee beneficiary. Create, checkpoint, and settle are all
// permissionless on-chain. The frontend uses this address purely to gate the
// demo operator console — a UI convenience, not a contract power.
export const OWNER_ADDRESS =
  "0x7bbcac9c77aabc2aca19cd34f944fbc015f06a54";

export const STUDIO_CHAIN_ID = 61999;
export const STUDIO_CHAIN_HEX = "0xF22F";
