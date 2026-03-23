# 軽量なPythonイメージを使用
FROM python:3.11-slim

# コンテナ内の作業ディレクトリを設定
WORKDIR /app

# 必要なライブラリをインストール
# pytz: 日本時間の管理用
# flask-sqlalchemy: データベース操作用
RUN pip install --no-cache-dir flask flask-sqlalchemy pytz

# アプリケーションファイルをコピー
COPY ./app /app

# 実行
CMD ["python", "main.py"]