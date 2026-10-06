/**
 * EIP-1193 Browser Web3 Wallet Integration for Lenis.
 *
 * Supports browser wallets (MetaMask, Coinbase Wallet, Rainbow, Brave, etc.)
 * for EIP-191 challenge signing and direct native / ERC-20 payment transactions.
 */

// ─── EVM Chain Specifications ──────────────────────────────────────────────────

export interface ChainConfig {
  chainId: number
  hexChainId: string
  name: string
  rpcUrls: string[]
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  blockExplorerUrls: string[]
}

export const KNOWN_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    chainId: 1,
    hexChainId: '0x1',
    name: 'Ethereum Mainnet',
    rpcUrls: ['https://eth.llamarpc.com'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://etherscan.io'],
  },
  base: {
    chainId: 8453,
    hexChainId: '0x2105',
    name: 'Base',
    rpcUrls: ['https://mainnet.base.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://basescan.org'],
  },
  polygon: {
    chainId: 137,
    hexChainId: '0x89',
    name: 'Polygon',
    rpcUrls: ['https://polygon-rpc.com'],
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    blockExplorerUrls: ['https://polygonscan.com'],
  },
  arbitrum: {
    chainId: 42161,
    hexChainId: '0xa4b1',
    name: 'Arbitrum One',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://arbiscan.io'],
  },
  optimism: {
    chainId: 10,
    hexChainId: '0xa',
    name: 'Optimism',
    rpcUrls: ['https://mainnet.optimism.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://optimistic.etherscan.io'],
  },
  bsc: {
    chainId: 56,
    hexChainId: '0x38',
    name: 'BNB Smart Chain',
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    blockExplorerUrls: ['https://bscscan.com'],
  },
}

// ─── ABI / Encoding Helpers ──────────────────────────────────────────────────

const ERC20_TRANSFER_SELECTOR = '0xa9059cbb' // transfer(address,uint256)

/**
 * Convert a UTF-8 string to 0x-prefixed hex string for standard EIP-191 personal_sign.
 */
export function toUtf8Hex(str: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(str)
  let hex = '0x'
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Format address as 32-byte ABI parameter (64 hex chars with leading zeros).
 */
function encodeAbiAddress(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, '')
  return clean.padStart(64, '0')
}

/**
 * Format BigInt amount as 32-byte ABI parameter.
 */
function encodeAbiUint256(amountBigInt: bigint): string {
  const hex = amountBigInt.toString(16)
  return hex.padStart(64, '0')
}

/**
 * Convert natural decimal string (e.g. "50.00") to BigInt integer units.
 */
export function parseTokenAmount(amountStr: string, decimals: number): bigint {
  const trimmed = amountStr.trim()
  const parts = trimmed.split('.')
  const whole = parts[0] || '0'
  let fraction = parts[1] || ''

  if (fraction.length > decimals) {
    fraction = fraction.slice(0, decimals)
  } else {
    fraction = fraction.padEnd(decimals, '0')
  }

  const combined = whole + fraction
  return BigInt(combined)
}

function parseWalletError(err: any, defaultMsg: string): Error {
  if (err?.code === 4001 || err?.message?.includes('User rejected')) {
    return new Error('Request was rejected in your wallet.')
  }
  if (err?.code === -32002) {
    return new Error('Request already pending in your wallet. Please check your browser extension.')
  }
  return new Error(err?.message || defaultMsg)
}

// ─── Web3 Connector Class ────────────────────────────────────────────────────

export class Web3WalletConnector {
  /**
   * Check if an injected EIP-1193 provider (MetaMask, etc.) is available.
   */
  static isAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean((window as any).ethereum)
  }

  /**
   * Check currently connected account without prompting.
   */
  static async getConnectedAccount(): Promise<string | null> {
    if (!this.isAvailable()) return null
    try {
      const ethereum = (window as any).ethereum
      const accounts: string[] = await ethereum.request({ method: 'eth_accounts' })
      return accounts && accounts.length > 0 ? accounts[0].toLowerCase() : null
    } catch {
      return null
    }
  }

  /**
   * Subscribe to wallet account changes. Returns an unsubscribe cleanup function.
   */
  static onAccountsChanged(callback: (accounts: string[]) => void): () => void {
    if (!this.isAvailable()) return () => {}
    const ethereum = (window as any).ethereum
    const handler = (accounts: string[]) => callback(accounts)
    ethereum.on('accountsChanged', handler)
    return () => {
      if (ethereum.removeListener) {
        ethereum.removeListener('accountsChanged', handler)
      }
    }
  }

  /**
   * Subscribe to wallet network / chain changes. Returns an unsubscribe cleanup function.
   */
  static onChainChanged(callback: (chainId: string) => void): () => void {
    if (!this.isAvailable()) return () => {}
    const ethereum = (window as any).ethereum
    const handler = (chainId: string) => callback(chainId)
    ethereum.on('chainChanged', handler)
    return () => {
      if (ethereum.removeListener) {
        ethereum.removeListener('chainChanged', handler)
      }
    }
  }

  /**
   * Request account connection.
   */
  static async connect(): Promise<{ address: string; chainId: number }> {
    if (!this.isAvailable()) {
      throw new Error('No Web3 wallet found. Please install MetaMask or another browser wallet.')
    }
    const ethereum = (window as any).ethereum
    try {
      const accounts: string[] = await ethereum.request({
        method: 'eth_requestAccounts',
      })

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts authorized in wallet.')
      }

      const hexChainId: string = await ethereum.request({ method: 'eth_chainId' })
      const chainId = parseInt(hexChainId, 16)

      return {
        address: accounts[0].toLowerCase(),
        chainId,
      }
    } catch (err: any) {
      throw parseWalletError(err, 'Failed to connect wallet.')
    }
  }

  /**
   * Switch active wallet network or prompt user to add network if missing.
   */
  static async switchNetwork(networkName: string): Promise<void> {
    if (!this.isAvailable()) return
    const ethereum = (window as any).ethereum
    const chainConfig = KNOWN_CHAINS[networkName.toLowerCase()]

    if (!chainConfig) {
      console.warn(`Chain config not found for network: ${networkName}`)
      return
    }

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainConfig.hexChainId }],
      })
    } catch (switchError: any) {
      // 4902 error code indicates that the chain has not been added to MetaMask
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: chainConfig.hexChainId,
                chainName: chainConfig.name,
                rpcUrls: chainConfig.rpcUrls,
                nativeCurrency: chainConfig.nativeCurrency,
                blockExplorerUrls: chainConfig.blockExplorerUrls,
              },
            ],
          })
        } catch (addErr: any) {
          throw parseWalletError(addErr, `Failed to add ${chainConfig.name} network to wallet.`)
        }
      } else {
        throw parseWalletError(switchError, `Failed to switch network to ${chainConfig.name}.`)
      }
    }
  }

  /**
   * Request EIP-191 personal signature from the connected wallet.
   * Encodes the challenge message to standard 0x-hex format for cross-wallet consistency.
   */
  static async signMessage(message: string, address: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('No Web3 wallet detected.')
    }
    const ethereum = (window as any).ethereum
    const hexMessage = toUtf8Hex(message)

    try {
      const signature: string = await ethereum.request({
        method: 'personal_sign',
        params: [hexMessage, address],
      })
      return signature
    } catch (err: any) {
      throw parseWalletError(err, 'Wallet signature request failed.')
    }
  }

  /**
   * Send a payment transaction:
   * - Native coin (ETH/MATIC/BNB): direct eth_sendTransaction
   * - ERC-20 Token (USDC/USDT/DAI): contract transfer(to, amount)
   */
  static async sendPayment(params: {
    network: string
    toAddress: string
    tokenSymbol: string
    contractAddress?: string | null
    amount: string
    fromAddress: string
  }): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('No Web3 wallet detected.')
    }
    const ethereum = (window as any).ethereum

    // Ensure wallet is switched to matching network
    await this.switchNetwork(params.network)

    const isNative = !params.contractAddress
    const decimals =
      params.tokenSymbol.toUpperCase() === 'USDC' || params.tokenSymbol.toUpperCase() === 'USDT'
        ? 6
        : 18

    const amountUnits = parseTokenAmount(params.amount, decimals)

    try {
      let txHash: string

      if (isNative) {
        // Native transfer
        const hexValue = '0x' + amountUnits.toString(16)
        txHash = await ethereum.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: params.fromAddress,
              to: params.toAddress,
              value: hexValue,
            },
          ],
        })
      } else {
        // ERC-20 Token Transfer
        const callData =
          ERC20_TRANSFER_SELECTOR +
          encodeAbiAddress(params.toAddress) +
          encodeAbiUint256(amountUnits)

        txHash = await ethereum.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: params.fromAddress,
              to: params.contractAddress,
              value: '0x0',
              data: callData,
            },
          ],
        })
      }

      return txHash
    } catch (err: any) {
      throw parseWalletError(err, 'Payment transaction was rejected or failed.')
    }
  }
}
