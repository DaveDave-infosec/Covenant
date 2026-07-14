# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


class GenUSDC(gl.Contract):
    balances: TreeMap[str, u256]
    total_supply: u256
    owner: str
    name: str
    symbol: str
    decimals: u256

    def __init__(self):
        self.owner = gl.message.sender_address.as_hex.lower()
        self.name = "GenLayer USDC"
        self.symbol = "GenUSDC"
        self.decimals = u256(6)
        self.total_supply = u256(0)

    @gl.public.write
    def mint(self, to: str, amount: u256) -> None:
        recipient = to.lower()
        self.balances[recipient] = self.balances.get(recipient, u256(0)) + amount
        self.total_supply += amount

    @gl.public.write
    def transfer(self, to: str, amount: u256) -> None:
        sender = gl.message.sender_address.as_hex.lower()
        recipient = to.lower()
        sender_balance = self.balances.get(sender, u256(0))
        assert sender_balance >= amount, "insufficient balance"
        self.balances[sender] = sender_balance - amount
        self.balances[recipient] = self.balances.get(recipient, u256(0)) + amount

    @gl.public.write
    def transfer_from(self, sender: str, to: str, amount: u256) -> None:
        from_addr = sender.lower()
        recipient = to.lower()
        from_balance = self.balances.get(from_addr, u256(0))
        assert from_balance >= amount, "insufficient balance"
        self.balances[from_addr] = from_balance - amount
        self.balances[recipient] = self.balances.get(recipient, u256(0)) + amount

    @gl.public.view
    def balance_of(self, account: str) -> u256:
        return self.balances.get(account.lower(), u256(0))

    @gl.public.view
    def get_total_supply(self) -> u256:
        return self.total_supply

    @gl.public.view
    def get_info(self) -> dict:
        return {
            "name": self.name,
            "symbol": self.symbol,
            "decimals": str(self.decimals),
            "total_supply": str(self.total_supply),
        }
