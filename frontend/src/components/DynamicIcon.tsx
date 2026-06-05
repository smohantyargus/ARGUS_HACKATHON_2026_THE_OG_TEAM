import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

interface DynamicIconProps extends LucideProps {
    name: string;
}

export const DynamicIcon = ({ name, ...rest }: DynamicIconProps) => {
    const IconComponent = (LucideIcons as any)[name];

    if (!IconComponent) {
        if (name) console.warn(`Icon ${name} not found in lucide-react`);
        return <LucideIcons.Box {...rest} />; 
    }

    return <IconComponent {...rest} />;
};
