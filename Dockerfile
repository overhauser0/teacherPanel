# 軽量なPythonイメージを使用
FROM python:3.11-slim

# コンテナ内の作業ディレクトリを設定
WORKDIR /app

# 1. まず requirements.txt だけをコピー（ビルド高速化のため）
COPY ./requirements.txt /app/requirements.txt

# 2. まとめてインストール
RUN pip install --no-cache-dir -r requirements.txt

# 3. アプリケーションファイルをコピー
COPY ./app /app

# 実行
CMD ["python", "main.py"]