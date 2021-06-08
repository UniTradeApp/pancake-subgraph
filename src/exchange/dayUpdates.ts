/* eslint-disable prefer-const */
import { BigInt, BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import { Bundle, Token, HourlyCandlestick } from "../../generated/schema";

export function updateTokenDayData(token: Token, event: ethereum.Event): HourlyCandlestick {
  let bundle = Bundle.load("1");
  let timestamp = event.block.timestamp.toI32();
  let dayID = timestamp / 3600;
  let dayStartTimestamp = dayID * 3600;
  let tokenDayID = token.id.toString().concat("-").concat(BigInt.fromI32(dayID).toString());
  let priceUSD = token.derivedBNB.times(bundle.bnbPrice);

  let tokenDayData = HourlyCandlestick.load(tokenDayID);
  if (tokenDayData === null) {
    tokenDayData = new HourlyCandlestick(tokenDayID);
    tokenDayData.date = dayStartTimestamp;
    tokenDayData.token = token.id;
    tokenDayData.openPriceUSD = priceUSD;
    tokenDayData.closePriceUSD = priceUSD;
    tokenDayData.lowPriceUSD = priceUSD;
    tokenDayData.highPriceUSD = priceUSD;
  }
  tokenDayData.closePriceUSD = priceUSD;

  if (tokenDayData.openPriceUSD.equals(BigDecimal.fromString("0"))) {
    tokenDayData.openPriceUSD = priceUSD;
  }

  if (tokenDayData.lowPriceUSD.equals(BigDecimal.fromString("0")) || priceUSD.lt(tokenDayData.lowPriceUSD)) {
    tokenDayData.lowPriceUSD = priceUSD;
  }

  if (priceUSD.gt(tokenDayData.highPriceUSD)) {
    tokenDayData.highPriceUSD = priceUSD;
  }

  tokenDayData.save();

  return tokenDayData as HourlyCandlestick;
}
