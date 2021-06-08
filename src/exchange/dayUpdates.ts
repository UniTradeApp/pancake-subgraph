/* eslint-disable prefer-const */
import { BigInt, BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import { Bundle, Token, TokenHourData } from "../../generated/schema";

export function updateTokenDayData(token: Token, event: ethereum.Event): TokenHourData {
  let bundle = Bundle.load("1");
  let timestamp = event.block.timestamp.toI32();
  let dayID = timestamp / 3600;
  let dayStartTimestamp = dayID * 3600;
  let tokenDayID = token.id.toString().concat("-").concat(BigInt.fromI32(dayID).toString());

  let tokenDayData = TokenHourData.load(tokenDayID);
  if (tokenDayData === null) {
    tokenDayData = new TokenHourData(tokenDayID);
    tokenDayData.date = dayStartTimestamp;
    tokenDayData.token = token.id;
    tokenDayData.priceUSD = token.derivedBNB.times(bundle.bnbPrice);
    tokenDayData.openPriceUSD = tokenDayData.priceUSD;
    tokenDayData.closePriceUSD = tokenDayData.priceUSD;
    tokenDayData.minPriceUSD = tokenDayData.priceUSD;
    tokenDayData.maxPriceUSD = tokenDayData.priceUSD;
  }
  tokenDayData.closePriceUSD = tokenDayData.priceUSD;
  tokenDayData.priceUSD = token.derivedBNB.times(bundle.bnbPrice);

  if (tokenDayData.openPriceUSD.equals(BigDecimal.fromString("0"))) {
    tokenDayData.openPriceUSD = tokenDayData.priceUSD;
  }

  if (
    tokenDayData.minPriceUSD.equals(BigDecimal.fromString("0")) ||
    tokenDayData.priceUSD.lt(tokenDayData.minPriceUSD)
  ) {
    tokenDayData.minPriceUSD = tokenDayData.priceUSD;
  }

  if (tokenDayData.priceUSD.gt(tokenDayData.maxPriceUSD)) {
    tokenDayData.maxPriceUSD = tokenDayData.priceUSD;
  }

  tokenDayData.save();

  return tokenDayData as TokenHourData;
}
