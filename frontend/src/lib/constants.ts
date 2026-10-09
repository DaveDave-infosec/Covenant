// Covenant — deployed contract addresses on GenLayer Studio Network.
// Chain ID 61999 (hex 0xF22F).

export const MONITOR_CONTRACT_ADDRESS =
  "0x18ECD959aE09E1B61A5DBDb89B733Bf39a161728";

export const VAULT_CONTRACT_ADDRESS =
  "0x8c668Ebc2A0F0fA9Cc2b6CD4a60ca202a1085f83";

// The deployer wallet. On v2 it holds NO contract authority: it is only the
// protocol fee beneficiary. Create, checkpoint, and settle are all
// permissionless on-chain. The frontend uses this address purely to gate the
// demo operator console — a UI convenience, not a contract power.
export const OWNER_ADDRESS =
  "0x7bbcac9c77aabc2aca19cd34f944fbc015f06a54";

export const STUDIO_CHAIN_ID = 61999;
export const STUDIO_CHAIN_HEX = "0xF22F";
