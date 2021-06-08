/* eslint-disable prefer-const */
import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { Pair, Token, PancakeFactory, Transaction, Swap as SwapEvent, Bundle } from "../../generated/schema";
import { Mint, Burn, Swap, Transfer, Sync } from "../../generated/templates/Pair/Pair";
import { updateTokenDayData } from "./dayUpdates";
import { getBnbPriceInUSD, findBnbPerToken, getTrackedVolumeUSD, getTrackedLiquidityUSD } from "./pricing";
import { convertTokenToDecimal, ADDRESS_ZERO, FACTORY_ADDRESS, ZERO_BD, BI_18 } from "./utils";

export function handleTransfer(event: Transfer): void {
  // Initial liquidity.
  if (event.params.to.toHex() == ADDRESS_ZERO && event.params.value.equals(BigInt.fromI32(1000))) {
    return;
  }

  // get pair and load contract
  let pair = Pair.load(event.address.toHex());

  // liquidity token amount being transferred
  let value = convertTokenToDecimal(event.params.value, BI_18);

  // get or create transaction
  let transaction = Transaction.load(event.transaction.hash.toHex());
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHex());
    transaction.block = event.block.number;
    transaction.timestamp = event.block.timestamp;
    transaction.swaps = [];
  }

  // mints
  // let mints = transaction.mints;
  if (event.params.from.toHex() == ADDRESS_ZERO) {
    // update total supply
    pair.totalSupply = pair.totalSupply.plus(value);
    pair.save();
  }

  // burn
  if (event.params.to.toHex() == ADDRESS_ZERO && event.params.from.toHex() == pair.id) {
    pair.totalSupply = pair.totalSupply.minus(value);
    pair.save();
  }

  transaction.save();
}

export function handleSync(event: Sync): void {
  let pair = Pair.load(event.address.toHex());
  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);
  let pancake = PancakeFactory.load(FACTORY_ADDRESS);

  // reset factory liquidity by subtracting only tracked liquidity
  pancake.totalLiquidityBNB = pancake.totalLiquidityBNB.minus(pair.trackedReserveBNB as BigDecimal);

  // reset token total liquidity amounts
  token0.totalLiquidity = token0.totalLiquidity.minus(pair.reserve0);
  token1.totalLiquidity = token1.totalLiquidity.minus(pair.reserve1);

  pair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals);
  pair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals);

  if (pair.reserve1.notEqual(ZERO_BD)) pair.token0Price = pair.reserve0.div(pair.reserve1);
  else pair.token0Price = ZERO_BD;
  if (pair.reserve0.notEqual(ZERO_BD)) pair.token1Price = pair.reserve1.div(pair.reserve0);
  else pair.token1Price = ZERO_BD;

  let bundle = Bundle.load("1");
  bundle.bnbPrice = getBnbPriceInUSD();
  bundle.save();

  let t0DerivedBNB = findBnbPerToken(token0 as Token);
  token0.derivedBNB = t0DerivedBNB;
  token0.derivedUSD = t0DerivedBNB.times(bundle.bnbPrice);
  token0.save();

  let t1DerivedBNB = findBnbPerToken(token1 as Token);
  token1.derivedBNB = t1DerivedBNB;
  token1.derivedUSD = t1DerivedBNB.times(bundle.bnbPrice);
  token1.save();

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityBNB: BigDecimal;
  if (bundle.bnbPrice.notEqual(ZERO_BD)) {
    trackedLiquidityBNB = getTrackedLiquidityUSD(
      bundle as Bundle,
      pair.reserve0,
      token0 as Token,
      pair.reserve1,
      token1 as Token
    ).div(bundle.bnbPrice);
  } else {
    trackedLiquidityBNB = ZERO_BD;
  }

  // use derived amounts within pair
  pair.trackedReserveBNB = trackedLiquidityBNB;
  pair.reserveBNB = pair.reserve0
    .times(token0.derivedBNB as BigDecimal)
    .plus(pair.reserve1.times(token1.derivedBNB as BigDecimal));
  pair.reserveUSD = pair.reserveBNB.times(bundle.bnbPrice);

  // use tracked amounts globally
  pancake.totalLiquidityBNB = pancake.totalLiquidityBNB.plus(trackedLiquidityBNB);
  pancake.totalLiquidityUSD = pancake.totalLiquidityBNB.times(bundle.bnbPrice);

  // now correctly set liquidity amounts for each token
  token0.totalLiquidity = token0.totalLiquidity.plus(pair.reserve0);
  token1.totalLiquidity = token1.totalLiquidity.plus(pair.reserve1);

  // save entities
  pair.save();
  pancake.save();
  token0.save();
  token1.save();
}

export function handleMint(event: Mint): void {
  let pair = Pair.load(event.address.toHex());
  let pancake = PancakeFactory.load(FACTORY_ADDRESS);

  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);

  // save entities
  token0.save();
  token1.save();
  pair.save();
  pancake.save();

  updateTokenDayData(token0 as Token, event);
  updateTokenDayData(token1 as Token, event);
}

export function handleBurn(event: Burn): void {
  let transaction = Transaction.load(event.transaction.hash.toHex());
  if (transaction === null) {
    return;
  }

  let pair = Pair.load(event.address.toHex());
  let pancake = PancakeFactory.load(FACTORY_ADDRESS);

  //update token info
  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);

  // update global counter and save
  token0.save();
  token1.save();
  pair.save();
  pancake.save();

  updateTokenDayData(token0 as Token, event);
  updateTokenDayData(token1 as Token, event);
}

export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHex());
  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);
  let amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals);
  let amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals);
  let amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals);
  let amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals);

  // totals for volume updates
  let amount0Total = amount0Out.plus(amount0In);
  let amount1Total = amount1Out.plus(amount1In);

  // BNB/USD prices
  let bundle = Bundle.load("1");

  // get total amounts of derived USD and BNB for tracking
  let derivedAmountBNB = token1.derivedBNB
    .times(amount1Total)
    .plus(token0.derivedBNB.times(amount0Total))
    .div(BigDecimal.fromString("2"));
  let derivedAmountUSD = derivedAmountBNB.times(bundle.bnbPrice);

  // only accounts for volume through white listed tokens
  let trackedAmountUSD = getTrackedVolumeUSD(
    bundle as Bundle,
    amount0Total,
    token0 as Token,
    amount1Total,
    token1 as Token
  );

  let trackedAmountBNB: BigDecimal;
  if (bundle.bnbPrice.equals(ZERO_BD)) {
    trackedAmountBNB = ZERO_BD;
  } else {
    trackedAmountBNB = trackedAmountUSD.div(bundle.bnbPrice);
  }

  // update pair volume data, use tracked amount if we have it as its probably more accurate
  pair.save();

  // update global values, only used tracked amounts for volume
  let pancake = PancakeFactory.load(FACTORY_ADDRESS);

  // save entities
  pair.save();
  token0.save();
  token1.save();
  pancake.save();

  let transaction = Transaction.load(event.transaction.hash.toHex());
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHex());
    transaction.block = event.block.number;
    transaction.timestamp = event.block.timestamp;
    transaction.swaps = [];
  }
  let swaps = transaction.swaps;
  let swap = new SwapEvent(event.transaction.hash.toHex().concat("-").concat(BigInt.fromI32(swaps.length).toString()));

  // update swap event
  swap.transaction = transaction.id;
  swap.pair = pair.id;
  swap.timestamp = transaction.timestamp;
  swap.transaction = transaction.id;
  swap.sender = event.params.sender;
  swap.amount0In = amount0In;
  swap.amount1In = amount1In;
  swap.amount0Out = amount0Out;
  swap.amount1Out = amount1Out;
  swap.to = event.params.to;
  swap.from = event.transaction.from;
  swap.logIndex = event.logIndex;
  // use the tracked amount if we have it
  swap.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD;
  swap.save();

  // update the transaction

  // TODO: Consider using .concat() for handling array updates to protect
  // against unintended side effects for other code paths.
  swaps.push(swap.id);
  transaction.swaps = swaps;
  transaction.save();
}
