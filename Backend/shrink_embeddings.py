import numpy as np

FILES = ["db_v_con.npy", "db_v_fac.npy", "db_v_wrk.npy"]

for fname in FILES:
    path = f"assets/{fname}"
    arr = np.load(path)
    print(f"{fname}: 기존 {arr.dtype}, {arr.nbytes / 1e6:.1f} MB")

    arr32 = arr.astype(np.float32)
    np.save(path, arr32)
    print(f"{fname}: 변환 후 {arr32.dtype}, {arr32.nbytes / 1e6:.1f} MB\n")

print("완료! assets 폴더의 파일들이 float32로 덮어써졌습니다.")
