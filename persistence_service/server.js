const redis = require('redis');
const express = require('express')
const app = express()
const port = 3000
const { MongoClient } = require('mongodb');
const axios = require('axios');
const uri = process.env.MONGODB_URL || "mongodb://mongo:27017/";
const NASDAQ_URL = "https://api.nasdaq.com/api/quote/<stock>/info?assetclass=stocks";
const NASDAQ_CHART_URL = "https://api.nasdaq.com/api/quote/<stock>/chart?assetclass=stocks"

const subscriber = redis.createClient(
  {
    url: `redis://${process.env.REDIS_HOST || "127.0.0.1"}:6379`
  }
);
subscriber.connect().catch((error)=>{console.error(error)});
const sender = redis.createClient(
  {
    url: `redis://${process.env.REDIS_HOST || "127.0.0.1"}:6379`
  }
);
sender.connect().catch((error)=>{console.error(error)});

async function saveOrder(order) {
  const client = new MongoClient(uri);
  try {
    const database = client.db('stock_market');
    order["timestamp"] = new Date();
    await database.collection("orders").insertOne(order, (err, res) => {
      if (err) throw err;
      console.log(res);
    });
  } finally {
    await client.close();
  }
}

async function getPortfolio() {
  const client = new MongoClient(uri);
  try {
    const database = client.db('stock_market');
    // Get the aggregation result.
    const cursor = database.collection("orders").aggregate([
      {
        $group: {
          _id: "$stock",
          totalShares: { $sum: "$quantity" },
          totalValue: { $sum: { $multiply: ["$quantity", "$price"] } },
        }
      }
    ])

    let aggregationResult = await cursor.toArray();
    aggregationResult = aggregationResult.map(async (stock) => {
      const response = await axios.get(NASDAQ_URL.replace("<stock>", stock._id));
      const realTimePriceQuote = response.data;
      let moneyFloat = parseFloat(realTimePriceQuote.data.primaryData.lastSalePrice.replace(/[^0-9.]/g, ""));
      let currentPrice = stock.totalShares * moneyFloat;
      let profitLoss = currentPrice - stock["totalValue"];
      let profitLossPercentage = (profitLoss / stock["totalValue"]) * 100;
      stock["profitLoss"] = profitLossPercentage;
      stock["currentPrice"] = currentPrice;
      let dayRange = realTimePriceQuote.data.keyStats.dayrange.value;
      if (dayRange !== "NA") {
        let range = dayRange.split("-");
        stock["lowerPrice"] = parseFloat(range[1]);
        stock["higherPrice"] = parseFloat(range[0]);
        stock["averagePrice"] = (range[0] + range[1]) / 2
      }
      return stock;
    })
    return Promise.all(aggregationResult);
  } finally {
    await client.close();
  }
}
function calculateAverage(arr) {
  const sum = arr.reduce((total, num) => total + num, 0);
  return sum / arr.length;
}

async function getHistorical() {
  const client = new MongoClient(uri);
  try {
    const database = client.db('stock_market');
    // Get the aggregation result.
    const cursor = database.collection("orders").aggregate([
      {
        $group: {
          _id: "$stock",
          totalShares: { $sum: "$quantity" }
        }
      }
    ])

    let aggregationResult = await cursor.toArray();
    aggregationResult = aggregationResult.map(async (stock) => {
      const response = await axios.get(NASDAQ_CHART_URL.replace("<stock>", stock._id));
      const chart = response.data.data.chart;
      let groupedData = {};
      for (const item of chart) {
        const dateTime = item.z.dateTime;
        let hour = parseInt(dateTime.split(":")[0]);
        if (dateTime.includes("PM")){
          hour+=12;
        }
        if (!groupedData[hour]) {
          groupedData[hour] = [];
        }
        groupedData[hour].push(item.y);
      }
      for (const key in groupedData) {
        const values = groupedData[key];
        const average = calculateAverage(values);
        groupedData[key] = average;
      }
      stock["historicalIn24HoursFormat"] = groupedData;
      return stock;
    })
    return Promise.all(aggregationResult);
  } finally {
    await client.close();
  }
}



try {
  subscriber.subscribe('stock_market', (message) => {
    console.log(message); 
    saveOrder(JSON.parse(message)).catch(console.dir);
   
  });
} catch (error) {
  console.error(error);
}

try {
  subscriber.subscribe('holding', async (message) => {
    const stocks = await getPortfolio().catch(console.dir);
    sender.publish('stocks_list', JSON.stringify(stocks));
  });
} catch (error) {
  console.error(error);
}

try {
  subscriber.subscribe('historic_request', async (message) => {
    const stocks = await getHistorical().catch(console.dir);
    sender.publish('historic_response', JSON.stringify(stocks));
  });
} catch (error) {
  console.error(error);
}

app.get('/', (req, res) => {
  res.send('Working!')
})

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
})