/* eslint-disable prefer-const */
import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { Pair, Token, PancakeFactory, Bundle } from "../../generated/schema";
import { Mint, Burn, Transfer, Sync } from "../../generated/templates/Pair/Pair";
import { updateTokenDayData } from "./dayUpdates";
import { getBnbPriceInUSD, findBnbPerToken } from "./pricing";
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
}

export function handleSync(event: Sync): void {
  let pair = Pair.load(event.address.toHex());
  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);
  let pancake = PancakeFactory.load(FACTORY_ADDRESS);

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

  // use derived amounts within pair
  pair.reserveBNB = pair.reserve0
    .times(token0.derivedBNB as BigDecimal)
    .plus(pair.reserve1.times(token1.derivedBNB as BigDecimal));
  pair.reserveUSD = pair.reserveBNB.times(bundle.bnbPrice);

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
