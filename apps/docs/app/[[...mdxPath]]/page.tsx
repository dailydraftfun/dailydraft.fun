import type { Metadata } from 'next';
import { generateStaticParamsFor, importPage } from 'nextra/pages';
import type { ComponentType, ReactNode } from 'react';
import { getMDXComponents } from '../../mdx-components';

export const generateStaticParams = generateStaticParamsFor('mdxPath');

type PageProps = Readonly<{
  params: Promise<{
    mdxPath?: string[];
  }>;
}>;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const { metadata } = await importPage(resolvedParams.mdxPath ?? []);
  return metadata;
}

export default async function Page({ params }: PageProps) {
  const resolvedParams = await params;
  const { default: MDXContent, toc, metadata } = await importPage(resolvedParams.mdxPath ?? []);
  const Wrapper = getMDXComponents().wrapper as ComponentType<{
    children: ReactNode;
    metadata: typeof metadata;
    toc: typeof toc;
  }>;

  return (
    <Wrapper toc={toc} metadata={metadata}>
      <MDXContent params={resolvedParams} />
    </Wrapper>
  );
}
