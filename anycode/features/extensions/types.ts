export interface ExtensionSummary {
  id: string;
  name: string;
  publisher: string;
  displayName: string;
  description: string;
  version: string;
  enabled: boolean;
  iconUrl?: string;
  readme?: string;
  commands: Array<{
    command: string;
    title: string;
    category?: string;
  }>;
  themes: Array<{
    id?: string;
    label: string;
    uiTheme: string;
    path: string;
  }>;
  iconThemes: Array<{
    id: string;
    label: string;
    path: string;
  }>;
  languages: Array<{
    id: string;
    extensions?: string[];
    aliases?: string[];
  }>;
  viewsContainers?: {
    activitybar?: Array<{
      id: string;
      title: string;
      icon?: string;
    }>;
    panel?: Array<{
      id: string;
      title: string;
      icon?: string;
    }>;
    [key: string]: any;
  };
  views?: {
    [containerId: string]: Array<{
      id: string;
      name: string;
      type?: 'tree' | 'webview';
      when?: string;
      icon?: string;
      visibility?: 'visible' | 'collapsed' | 'hidden';
    }>;
  };
}

export interface OpenVsxExtension {
  id: string;
  name: string;
  namespace: string;
  version: string;
  displayName?: string;
  description?: string;
  downloadCount?: number;
  averageRating?: number;
  reviewCount?: number;
  iconUrl?: string;
  files?: {
    icon?: string;
    download?: string;
    readme?: string;
  };
}
