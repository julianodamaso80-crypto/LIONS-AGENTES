import { useState, useEffect } from 'react';
import { getAdminSession } from '@/lib/adminSession';

export function useAdminRole() {
    const [role, setRole] = useState<'master' | 'company_admin' | 'member' | null>(null);
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [isOwner, setIsOwner] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        checkRole();
    }, []);

    const checkRole = () => {
        try {
            // 1. Verificar se tem sessão admin (Master OU Company Admin)
            const adminSession = getAdminSession();

            if (adminSession) {
                setRole(adminSession.role as 'master' | 'company_admin');
                setCompanyId(adminSession.companyId || null);
                setIsLoading(false);

                // Se é company_admin, buscar is_owner via ADMIN API
                if (adminSession.role === 'company_admin') {
                    fetch('/api/admin/me', { credentials: 'include' })
                        .then(res => res.ok ? res.json() : null)
                        .then(data => {
                            if (data?.user?.is_owner !== undefined) {
                                setIsOwner(data.user.is_owner);
                            }
                        })
                        .catch(() => { });
                }

                return;
            }

            // 2. Verificar user session via ADMIN API (prioriza admin, rejeita membros)

            fetch('/api/admin/me', {
                credentials: 'include'
            })
                .then(res => {
                    if (res.status === 403) {
                        // Member trying to access admin context
                        setRole('member');
                        setIsOwner(false);
                        setIsLoading(false);
                        return null;
                    }
                    if (res.ok) return res.json();
                    throw new Error('Not logged in');
                })
                .then(data => {
                    if (!data) return; // Already handled 403

                    if (data.user) {
                        const userRole = data.user.role || 'member';

                        if (userRole === 'master') {
                            setRole('master');
                            setIsOwner(true);
                        } else if (userRole === 'admin_company' || userRole === 'owner' || userRole === 'admin') {
                            setRole('company_admin');
                            setIsOwner(data.user.is_owner || false);
                        } else {
                            setRole('member');
                            setIsOwner(false);
                        }

                        setCompanyId(data.user.company_id || null);
                    } else {
                        setRole(null);
                    }
                })
                .catch((error) => {
                    setRole(null);
                })
                .finally(() => {
                    setIsLoading(false);
                });

        } catch (error) {
            console.error('[useAdminRole] Error checking role:', error);
            setRole(null);
            setIsLoading(false);
        }
    };

    return { role, companyId, isOwner, isLoading };
}
