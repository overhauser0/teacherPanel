import os
import uuid
from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from datetime import datetime
import pytz

app = Flask(__name__)
app.secret_key = "juku_secret_key" # 適宜変更
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 # 最大16MB

db = SQLAlchemy(app)

# 教室リスト（管理用）
CLASSROOMS = ["上安校", "緑井校", "中筋校", "白島校","中広校","広島駅前校","古江校","皆実町校","安芸府中校"]

# 管理者設定（環境変数がなければデフォルト値）
ADMIN_ID = os.getenv("ADMIN_ID", "owner")
ADMIN_PW = os.getenv("ADMIN_PW", "1TO1netz")

# 日本時間を設定
def get_jst_now():
    return datetime.now(pytz.timezone('Asia/Tokyo'))

class Teacher(db.Model):
    uuid = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    display_id = db.Column(db.String(6), unique=True)
    password = db.Column(db.String(20))
    gender = db.Column(db.String(10)) # male or female
    name = db.Column(db.String(50))
    hometown = db.Column(db.String(20))
    subject = db.Column(db.String(50))
    classroom = db.Column(db.String(50)) # 管理用
    comment = db.Column(db.String(250)) # 最大200〜250文字程度想定
    image_filename = db.Column(db.String(100))
    updated_at = db.Column(db.DateTime, default=get_jst_now, onupdate=get_jst_now)

with app.app_context():
    db.create_all()

# --- ルーティング ---

@app.route('/')
def index():
    return render_template('login.html')

@app.route('/login', methods=['POST'])
def login():
    uid = request.form.get('id')
    pw = request.form.get('password')
    
    if uid == ADMIN_ID and pw == ADMIN_PW:
        session['role'] = 'admin'
        return redirect(url_for('admin'))
    
    teacher = Teacher.query.filter_by(display_id=uid, password=pw).first()
    if teacher:
        session['role'] = 'teacher'
        session['uuid'] = teacher.uuid
        return redirect(url_for('edit', teacher_uuid=teacher.uuid))
    
    return "認証に失敗しました。IDまたはPWを確認してください。", 403

@app.route('/register', methods=['GET', 'POST'])

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        uid = request.form.get('id')
        
        # 1. 最初に「この人のための専用ID」を生成する
        teacher_uuid = str(uuid.uuid4())
        
        new_teacher = Teacher(
            uuid=teacher_uuid, # 生成したIDを明示的に入れる
            display_id=uid,
            password=request.form.get('password'),
            gender=request.form.get('gender'),
            name=request.form.get('name'),
            hometown=request.form.get('hometown'),
            subject=request.form.get('subject'),
            classroom=request.form.get('classroom'),
            comment=request.form.get('comment')
        )
        
        # 2. 画像の処理
        file = request.files.get('image')
        if file and file.filename != '':
            ext = os.path.splitext(file.filename)[1]
            # 2. 生成したIDをファイル名にする
            filename = f"{teacher_uuid}{ext}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)
            new_teacher.image_filename = filename
            
        # 3. データベースに保存
        db.session.add(new_teacher)
        db.session.commit()
        
        # 4. 完了画面を表示
        return render_template('complete.html', is_edit=False)
    return render_template('register.html', classrooms=CLASSROOMS)
    
@app.route('/edit/<teacher_uuid>', methods=['GET', 'POST'])
def edit(teacher_uuid):
    if session.get('role') != 'admin' and session.get('uuid') != teacher_uuid:
        return redirect(url_for('index'))
    
    teacher = Teacher.query.get_or_404(teacher_uuid)
    
    if request.method == 'POST':
        file = request.files.get('image')
        if file and file.filename != '':
            ext = os.path.splitext(file.filename)[1]
            # この人のUUID（teacher_uuid）をファイル名にする
            filename = f"{teacher_uuid}{ext}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)
            teacher.image_filename = filename
            
        db.session.commit()
        # adminなら一覧へ、講師ならトップ（ログアウト状態）へ
        if session.get('role') == 'admin':
            return redirect(url_for('admin'))
        else:
            session.clear() # 編集後はセキュリティのためログアウト
            return render_template('complete.html', is_edit=True)
            
    return render_template('edit.html', teacher=teacher, classrooms=CLASSROOMS)

# 削除機能の追加
@app.route('/delete/<teacher_uuid>', methods=['POST'])
def delete_teacher(teacher_uuid):
    if session.get('role') != 'admin':
        return redirect(url_for('index'))
    
    teacher = Teacher.query.get_or_404(teacher_uuid)
    # 画像ファイルがあれば削除
    if teacher.image_filename:
        try:
            os.remove(os.path.join(app.config['UPLOAD_FOLDER'], teacher.image_filename))
        except:
            pass
            
    db.session.delete(teacher)
    db.session.commit()
    return redirect(url_for('admin'))

@app.route('/admin')
def admin():
    if session.get('role') != 'admin': return redirect(url_for('index'))
    
    # クエリパラメータを取得
    classroom_filter = request.args.get('classroom', '')
    sort_by = request.args.get('sort', 'updated_at') # デフォルトは更新日時順
    order = request.args.get('order', 'desc')

    query = Teacher.query

    # フィルター適用
    if classroom_filter:
        query = query.filter_by(classroom=classroom_filter)

    # ソート適用
    if sort_by == 'name':
        col = Teacher.name
    elif sort_by == 'display_id':
        col = Teacher.display_id
    else:
        col = Teacher.updated_at

    if order == 'asc':
        query = query.order_by(col.asc())
    else:
        query = query.order_by(col.desc())

    teachers = query.all()
    return render_template('admin.html', 
                           teachers=teachers, 
                           classrooms=CLASSROOMS, 
                           current_filter=classroom_filter,
                           current_sort=sort_by,
                           current_order=order)

@app.route('/print', methods=['POST'])
def print_cards():
    if session.get('role') != 'admin': return redirect(url_for('index'))
    ids = request.form.getlist('selected_teachers')
    teachers = Teacher.query.filter(Teacher.uuid.in_(ids)).all()
    return render_template('print.html', teachers=teachers)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)