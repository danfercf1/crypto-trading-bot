const Order = require('../../dict/order');
const ExchangeOrder = require('../../dict/exchange_order');
const OrderUtil = require('../../utils/order_util');

module.exports = class RiskRewardRatioCalculator {
  constructor(logger) {
    this.logger = logger;
  }

  calculateForOpenPosition(position, options = { stop_percent: 3, target_percent: 6, leverage: 1 }) {
    let entryPrice = position.entry;
    if (!entryPrice) {
      this.logger.info(`Invalid position entryPrice for stop loss:${JSON.stringify(position)}`);
      return undefined;
    }
    console.log('options', options);
    const result = {
      stop: undefined,
      target: undefined
    };

    entryPrice = Math.abs(entryPrice);
    const targetPercent = options.target_percent / 100;
    const stopPercent = options.stop_percent / 100;
    console.log('entryPrice', entryPrice);
    console.log('options', options);
    console.log('targetPercent', targetPercent);
    console.log('stopPercent', stopPercent);
    if (position.side === 'long') {
      if (options.leverage > 1) {
        // Binance target price calculation Long target price = entry price * ( ROE% / leverage + 1 )
        result.target = entryPrice * (targetPercent / options.leverage + 1);
        // Binance target price calculation Short target price = entry price * ( 1 - ROE% / leverage )
        result.stop = entryPrice * (1 - stopPercent / options.leverage);
      } else {
        result.target = entryPrice * (1 + targetPercent);
        result.stop = entryPrice * (1 - stopPercent);
      }
    } else {
      // eslint-disable-next-line no-lonely-if
      if (options.leverage > 1) {
        // Binance target price calculation Short target price = entry price * ( 1 - ROE% / leverage )
        result.target = entryPrice * (1 - targetPercent / options.leverage);
        // Binance stop price calculation Long target price = entry price * ( ROE% / leverage + 1 )
        result.stop = entryPrice * (stopPercent / options.leverage + 1);
      } else {
        result.target = entryPrice * (1 - targetPercent);
        result.stop = entryPrice * (1 + stopPercent);
      }
    }
    console.log('result', result);
    return result;
  }

  async syncRatioRewardOrders(position, orders, options) {
    const newOrders = {};

    const riskRewardRatio = this.calculateForOpenPosition(position, options);

    const stopOrders = orders.filter(order => order.type === ExchangeOrder.TYPE_STOP);
    if (stopOrders.length === 0) {
      newOrders.stop = {
        amount: Math.abs(position.amount),
        price: riskRewardRatio.stop
      };

      // inverse price for lose long position via sell
      if (position.side === 'long') {
        newOrders.stop.price = newOrders.stop.price * -1;
      }
    } else {
      // update order
      const stopOrder = stopOrders[0];

      // only +1% amount change is important for us
      if (OrderUtil.isPercentDifferentGreaterThen(position.amount, stopOrder.amount, 1)) {
        let amount = Math.abs(position.amount);
        if (position.isLong()) {
          amount *= -1;
        }

        newOrders.stop = {
          id: stopOrder.id,
          amount: amount
        };
      }
    }

    const targetOrders = orders.filter(order => order.type === ExchangeOrder.TYPE_LIMIT);
    if (targetOrders.length === 0) {
      newOrders.target = {
        amount: Math.abs(position.amount),
        price: riskRewardRatio.target
      };

      // inverse price for lose long position via sell
      if (position.side === 'long') {
        newOrders.target.price = newOrders.target.price * -1;
      }
    } else {
      // update order
      const targetOrder = targetOrders[0];

      // only +1% amount change is important for us
      if (OrderUtil.isPercentDifferentGreaterThen(position.amount, targetOrder.amount, 1)) {
        let amount = Math.abs(position.amount);
        if (position.isLong()) {
          amount *= -1;
        }

        newOrders.target = {
          id: targetOrder.id,
          amount: amount
        };
      }
    }

    return newOrders;
  }

  async createRiskRewardOrdersOrders(position, orders, options) {
    const ratioOrders = await this.syncRatioRewardOrders(position, orders, options);

    const newOrders = [];
    if (ratioOrders.target) {
      if (ratioOrders.target.id) {
        newOrders.push({
          id: ratioOrders.target.id,
          price: ratioOrders.target.price,
          amount: ratioOrders.target.amount
        });
      } else {
        newOrders.push({
          price: ratioOrders.target.price || undefined,
          amount: ratioOrders.target.amount || undefined,
          type: 'target'
        });
      }
    }

    if (ratioOrders.stop) {
      if (ratioOrders.stop.id) {
        newOrders.push({
          id: ratioOrders.stop.id,
          price: ratioOrders.stop.price,
          amount: ratioOrders.stop.amount
        });
      } else {
        newOrders.push({
          price: ratioOrders.stop.price,
          amount: ratioOrders.stop.amount,
          type: 'stop'
        });
      }
    }

    return newOrders;
  }
};
