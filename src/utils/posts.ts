type BlogFlags = {
  data: {
    draft?: boolean;
    archived?: boolean;
  };
};

/** 出现在首页、列表、标签和 RSS 里的文章。草稿和归档都不进列表。 */
export function isListedPost(post: BlogFlags): boolean {
  return !post.data.draft && !post.data.archived;
}
