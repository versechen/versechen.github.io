import Giscus from '@giscus/react';

export default function Comments() {
  return (
    <div className="comments-section">
      <Giscus
        id="comments"
        repo="chenwei/codeverse" // 请替换为你的 GitHub 用户名/仓库名
        repoId="" // 需要从 GitHub 获取
        category="General"
        categoryId="" // 需要从 GitHub 获取
        mapping="pathname"
        term="Welcome to @giscus/react component!"
        reactionsEnabled="1"
        emitMetadata="0"
        inputPosition="top"
        theme="light"
        lang="zh-CN"
        loading="lazy"
      />
    </div>
  );
}