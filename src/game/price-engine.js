import { GAME_CONFIG } from '../config.js';

export function formatPrice(amount) {
  if (amount == null || isNaN(amount)) return '₩0';
  return '₩' + Math.round(amount).toLocaleString('ko-KR');
}

export function calculateBasePrice(territory) {
  const { admin_level, area, population, significance } = territory;
  const levelFactor = GAME_CONFIG.LEVEL_FACTORS[admin_level] || 50_000;
  const areaFactor = area > 0 ? Math.log(area) : 1;
  const popFactor = population > 0 ? Math.log(population) : 1;
  const sigFactor = (significance || 1) / 5;

  return Math.round(levelFactor * areaFactor * popFactor * sigFactor);
}

export function calculateIncomePerHour(basePrice, taxRate = GAME_CONFIG.TAX_RATE) {
  return Math.round((basePrice / GAME_CONFIG.INCOME_DIVISOR) * (1 - taxRate));
}

export function calculatePurchasePrice(currentPrice) {
  return Math.round(currentPrice * (1 + GAME_CONFIG.PURCHASE_PRICE_INCREASE));
}

export function calculateSaleReturn(currentPrice) {
  return Math.round(currentPrice * GAME_CONFIG.BANK_SALE_RATIO);
}

export function calculatePlayerSaleReturn(currentPrice) {
  return Math.round(currentPrice * (1 - GAME_CONFIG.PLAYER_SALE_TAX));
}

export function calculateNewPriceAfterPurchase(currentPrice) {
  return Math.round(currentPrice * (1 + GAME_CONFIG.PURCHASE_PRICE_INCREASE));
}

export function calculateNewPriceAfterSale(currentPrice) {
  return Math.round(currentPrice * (1 - GAME_CONFIG.SALE_PRICE_DECREASE));
}
