import Cloudflare from 'cloudflare';

/**
 * メッセージテキストがURL単体かどうかを判定
 *
 * @param text - 判定対象のテキスト
 * @returns URL単体の場合true、それ以外false
 *
 * @example
 * isUrlOnly('https://example.com') // true
 * isUrlOnly('https://example.com\nhttps://example.org') // false
 * isUrlOnly('Check this https://example.com') // false
 */
export function isUrlOnly(text: string): boolean {
  const trimmed = text.trim();
  return /^https?:\/\/.+$/.test(trimmed) && !trimmed.includes('\n');
}

/**
 * HTMLからOGPメタタグの値を抽出
 *
 * @param html - HTML文字列
 * @param property - OGPプロパティ名（例: og:title, og:description）
 * @returns 抽出された値、見つからない場合undefined
 *
 * @example
 * extractOgpMeta('<meta property="og:title" content="Example">', 'og:title') // 'Example'
 */
export function extractOgpMeta(
  html: string,
  property: string,
): string | undefined {
  const regex = new RegExp(
    `<meta\\s+property=["']${property}["']\\s+content=["']([^"']+)["']`,
    'i',
  );
  const match = html.match(regex);
  return match?.[1];
}

/**
 * HTMLからタイトルを抽出（OGP優先、フォールバック: titleタグ）
 *
 * @param html - HTML文字列
 * @returns タイトル文字列、見つからない場合空文字
 *
 * @example
 * extractTitle('<meta property="og:title" content="Example">') // 'Example'
 * extractTitle('<title>Fallback Title</title>') // 'Fallback Title'
 */
function extractTitle(html: string): string {
  const ogTitle = extractOgpMeta(html, 'og:title');
  if (ogTitle) return ogTitle;

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1] : '';
}

/**
 * URLからMarkdown本文と記事メタデータを取得
 *
 * @param params - 取得パラメータ
 * @param params.url - 記事URL
 * @param params.env - Cloudflare Worker環境変数
 * @returns 記事情報（url, title, markdown等）、エラー時はnull
 *
 * @example
 * const article = await fetchArticleMarkdown({ url: 'https://example.com', env });
 * if (article) {
 *   console.log(article.title, article.markdown);
 * }
 */
export async function fetchArticleMarkdown({
  url,
  env,
}: {
  url: string;
  env: Env;
}): Promise<{
  url: string;
  title: string;
  description?: string;
  author?: string;
  image?: string;
  markdown: string;
} | null> {
  try {
    const htmlResponse = await fetch(url);
    const html = await htmlResponse.text();

    const title = extractTitle(html);
    const description = extractOgpMeta(html, 'og:description');
    const author = extractOgpMeta(html, 'article:author');
    const image = extractOgpMeta(html, 'og:image');

    const client = new Cloudflare({
      apiToken: env.CLOUDFLARE_API_TOKEN,
    });

    const markdown = await client.browserRendering.markdown.create({
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      url,
      rejectResourceTypes: ['stylesheet', 'image', 'media', 'font'],
      rejectRequestPattern: [
        '/^.*\\.(css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/',
      ],
      addScriptTag: [
        {
          content: `document.querySelectorAll('aside, header, footer').forEach(el => el.remove());`,
        },
      ],
    });

    return {
      url,
      title,
      description,
      author,
      image,
      markdown,
    };
  } catch (error) {
    console.error('Failed to fetch article markdown:', error);
    return null;
  }
}
