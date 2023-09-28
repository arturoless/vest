from re import sub
from flask import Flask, request
import requests
import redis
import json
from decimal import Decimal
import os
redis_server = redis.Redis(
    host=os.getenv('REDIS_HOST', '127.0.0.1'),
    port=6379,
    decode_responses=True
)
app = Flask(__name__)

NASDAQ_URL = "https://api.nasdaq.com/api/quote/{}/info?assetclass=stocks"

@app.route("/api/v1/stocks", methods = ['POST'])
def buy_stock():
    order_request = request.get_json()
    headers = {
        "Accept-Language":"en-US,en;q=0.9",
        "Accept-Encoding":"gzip, deflate, br",
        "User-Agent":"Java-http-client/"
    }
    url = NASDAQ_URL.format(order_request.get("stock"))
    response = requests.get(url, headers=headers)
    nasdaq_response = response.json()
    data = nasdaq_response.get("data")
    if not data:
        return "", 404
    price = data.get("primaryData").get("lastSalePrice")
    price = Decimal(sub(r'[^\d.]', '', price))
    order_request["price"] = float(price)
    redis_server.publish("stock_market", json.dumps(order_request))
    return {"succes":True}, 200

@app.route("/api/v1/stocks", methods = ['GET'])
def get_stocks():
    redis_server.publish("holding", "stocks")
    mobile = redis_server.pubsub()
    mobile.subscribe("stocks_list")
    for message in mobile.listen():
        if message["type"] == "message":
            mobile.close()
            return json.loads(message["data"]), 200

@app.route("/api/v1/stocks/historical", methods = ['GET'])
def get_historical():
    redis_server.publish("historic_request", "stocks")
    mobile = redis_server.pubsub()
    mobile.subscribe("historic_response")
    for message in mobile.listen():
        if message["type"] == "message":
            mobile.close()
            return json.loads(message["data"]), 200