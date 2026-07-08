interface LoadingScreenProps {
  error: string | null;
}

export function LoadingScreen({ error }: LoadingScreenProps) {
  if (error) {
    return (
      <div className="screen loading-screen">
        <h1>読み込みエラー</h1>
        <p className="error-message">{error}</p>
        <p>
          <code>npm run build:network -- --fixture</code> を実行してください。
        </p>
      </div>
    );
  }

  return (
    <div className="screen loading-screen">
      <h1>人力路線検索マスター</h1>
      <p>路線データを読み込み中...</p>
      <div className="spinner" aria-hidden="true" />
    </div>
  );
}
