export interface paths {
    "/docs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Docs_docs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Health_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Health_ready"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Health_metrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Docs_openapi"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/analytics/cohorts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Analytics_cohorts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/analytics/funnel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Analytics_funnel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/analytics/insights": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Analytics_insights"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/analytics/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Analytics_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/analytics/live/funnel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Analytics_liveFunnel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/analytics/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Analytics_overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/analytics/timeseries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Analytics_timeseries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/analytics/top-products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Analytics_topProducts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["ApiKeys_list"];
        put?: never;
        
        post: operations["ApiKeys_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/api-keys/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["ApiKeys_revoke"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/audit-log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Audit_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/campaigns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Campaigns_list"];
        put?: never;
        
        post: operations["Campaigns_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/campaigns/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Campaigns_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        
        patch: operations["Campaigns_update"];
        trace?: never;
    };
    "/v1/admin/campaigns/{id}/creatives": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Campaigns_createCreative"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/campaigns/{id}/creatives/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Campaigns_generate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/campaigns/{id}/experiment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Experiments_experiment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/campaigns/preview-products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Campaigns_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["CatalogAdmin_categories"];
        put?: never;
        
        post: operations["CatalogAdmin_createCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/categories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["CatalogAdmin_deleteCategory"];
        options?: never;
        head?: never;
        
        patch: operations["CatalogAdmin_updateCategory"];
        trace?: never;
    };
    "/v1/admin/creatives/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        
        patch: operations["Creatives_update"];
        trace?: never;
    };
    "/v1/admin/creatives/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Creatives_review"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/creatives/review-queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Creatives_queue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/customers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Customers_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/customers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Customers_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/customers/{id}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Customers_profile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/customers/{id}/timeline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Customers_timeline"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/decisions/{decisionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Experiments_decision"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/discounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Discounts_list"];
        put?: never;
        
        post: operations["Discounts_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/discounts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["Discounts_remove"];
        options?: never;
        head?: never;
        
        patch: operations["Discounts_update"];
        trace?: never;
    };
    "/v1/admin/features": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Creatives_features"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/inventory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Inventory_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/inventory/{variantId}/adjust": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Inventory_adjust"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/inventory/{variantId}/movements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Inventory_movements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Team_invitations"];
        put?: never;
        
        post: operations["Team_invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/invitations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["Team_revoke"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Jobs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Team_members"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["Team_remove"];
        options?: never;
        head?: never;
        
        patch: operations["Team_update"];
        trace?: never;
    };
    "/v1/admin/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Orders_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Orders_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/refund": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Orders_refund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/orders/{id}/transitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Orders_transition"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["CatalogAdmin_products"];
        put?: never;
        
        post: operations["CatalogAdmin_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["CatalogAdmin_get"];
        put?: never;
        post?: never;
        
        delete: operations["CatalogAdmin_remove"];
        options?: never;
        head?: never;
        
        patch: operations["CatalogAdmin_update"];
        trace?: never;
    };
    "/v1/admin/products/{id}/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["CatalogAdmin_upload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}/images/{imageId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["CatalogAdmin_deleteImage"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/{id}/images/order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        
        put: operations["CatalogAdmin_reorder"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/products/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["CatalogAdmin_importProducts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/profiles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Profiles_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/realtime/ticket": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Analytics_ticket"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/segments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Segments_list"];
        put?: never;
        
        post: operations["Segments_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/segments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["Segments_remove"];
        options?: never;
        head?: never;
        
        patch: operations["Segments_update"];
        trace?: never;
    };
    "/v1/admin/segments/features": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Segments_features"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/segments/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Segments_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Settings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        
        patch: operations["Settings_update"];
        trace?: never;
    };
    "/v1/admin/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Webhooks_list"];
        put?: never;
        
        post: operations["Webhooks_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["Webhooks_remove"];
        options?: never;
        head?: never;
        
        patch: operations["Webhooks_update"];
        trace?: never;
    };
    "/v1/admin/webhooks/{id}/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Webhooks_deliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/webhooks/deliveries/{deliveryId}/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Webhooks_resend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Auth_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Auth_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Auth_refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/signup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Auth_signup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invitations/{token}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Team_accept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Auth_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/payments/fake/{intentId}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Payments_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/payments/webhooks/{provider}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Payments_webhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/dlq": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Platform_dlq"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/dlq/{queue}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Platform_peek"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/dlq/{queue}/replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Platform_replay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/simulator": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Simulator_state"];
        put?: never;
        
        post: operations["Simulator_command"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/simulator/ground-truth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Simulator_groundTruth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/tenants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Platform_tenants"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/account/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["CustomerAuth_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/account/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Orders_accountOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["CustomerAuth_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["CustomerAuth_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["CustomerAuth_refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["CustomerAuth_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/cart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Cart_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/cart/discount": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Cart_discount"];
        
        delete: operations["Cart_removeDiscount"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/cart/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Cart_add"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/cart/items/{variantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        
        delete: operations["Cart_remove"];
        options?: never;
        head?: never;
        
        patch: operations["Cart_update"];
        trace?: never;
    };
    "/v1/storefront/catalog/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["CatalogStorefront_categories"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/catalog/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["CatalogStorefront_products"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/catalog/products/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["CatalogStorefront_product"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/checkout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        
        post: operations["Checkout_place"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Decisions_decide"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/decisions/{id}/explanation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Decisions_explanation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Orders_publicOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/recommendations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Recommendations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/search/suggest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["CatalogStorefront_suggest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/storefront/store": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        
        get: operations["Settings_store"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    Docs_docs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Health_live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        checks?: {
                            [key: string]: string;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Health_ready: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        checks?: {
                            [key: string]: string;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Health_metrics: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Docs_openapi: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_cohorts: {
        parameters: {
            query?: {
                period?: "week";
                weeks?: number;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        period: string;
                        cohorts: {
                            cohort: string;
                            size: number;
                            retention: number[];
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_funnel: {
        parameters: {
            query?: {
                from?: string;
                to?: string;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        steps: {
                            step: string;
                            users: number;
                            conversionFromPrev: number | null;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_insights: {
        parameters: {
            query?: {
                days?: number;
                refresh?: "true" | "false";
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        generatedAt: string;
                        model: string;
                        cached: boolean;
                        period: {
                            from: string;
                            to: string;
                        };
                        observations: {
                            title: string;
                            detail: string;
                            
                            severity: "info" | "positive" | "warning";
                            basis: {
                                metric: string;
                                value: number | string;
                            }[];
                        }[];
                        aggregates: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_live: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ts: number;
                        activeVisitors: number;
                        revenueTodayCents: number;
                        ordersToday: number;
                        series: {
                            ts: number;
                            eventsPerSec: number;
                        }[];
                        feed: {
                            eventId: string;
                            eventType: string;
                            occurredAt: string;
                            country: string | null;
                            label: string;
                            productId: string | null;
                            revenueCents: number | null;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_liveFunnel: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        steps: {
                            step: string;
                            users: number;
                            conversionFromPrev: number | null;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_overview: {
        parameters: {
            query?: {
                from?: string;
                to?: string;
                compare?: "prev" | "none";
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        from: string;
                        to: string;
                        revenueCents: {
                            value: number;
                            previous: number | null;
                            deltaPct: number | null;
                        };
                        orders: {
                            value: number;
                            previous: number | null;
                            deltaPct: number | null;
                        };
                        aovCents: {
                            value: number;
                            previous: number | null;
                            deltaPct: number | null;
                        };
                        conversionRate: {
                            value: number;
                            previous: number | null;
                            deltaPct: number | null;
                        };
                        visitors: {
                            value: number;
                            previous: number | null;
                            deltaPct: number | null;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_timeseries: {
        parameters: {
            query?: {
                from?: string;
                to?: string;
                metric?: "revenue" | "orders" | "events" | "visitors" | "product_views";
                interval?: "hour" | "day";
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        metric: string;
                        interval: string;
                        points: {
                            t: string;
                            value: number;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_topProducts: {
        parameters: {
            query?: {
                from?: string;
                to?: string;
                by?: "revenue" | "views" | "purchases" | "add_to_cart";
                limit?: number;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        by: string;
                        items: {
                            productId: string;
                            title: string | null;
                            views: number;
                            addToCart: number;
                            purchases: number;
                            revenueCents: number;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    ApiKeys_list: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            
                            kind: "publishable" | "secret";
                            prefix: string;
                            scopes: string[];
                            createdAt: string;
                            lastUsedAt: string | null;
                            revokedAt: string | null;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    ApiKeys_create: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    kind: "publishable" | "secret";
                    
                    scopes?: ("catalog:read" | "catalog:write" | "inventory:write" | "orders:read" | "orders:manage" | "customers:read" | "marketing:write" | "marketing:approve" | "analytics:read" | "staff:manage" | "apikeys:manage" | "settings:write")[];
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        
                        kind: "publishable" | "secret";
                        prefix: string;
                        scopes: string[];
                        createdAt: string;
                        lastUsedAt: string | null;
                        revokedAt: string | null;
                        secret: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    ApiKeys_revoke: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Audit_list: {
        parameters: {
            query?: {
                actorId?: string;
                entityType?: string;
                entityId?: string;
                action?: string;
                from?: string;
                to?: string;
                limit?: number;
                cursor?: string;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            actorType: string;
                            actorId: string | null;
                            actorName: string | null;
                            action: string;
                            entityType: string;
                            entityId: string | null;
                            diff: {
                                [key: string]: [
                                    unknown,
                                    unknown
                                ];
                            } | null;
                            ip: string | null;
                            createdAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Campaigns_list: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            name: string;
                            
                            placement: "home_hero" | "pdp_sidebar" | "cart_upsell" | "category_banner";
                            
                            status: "draft" | "active" | "paused" | "ended";
                            targetSegments: string[];
                            productSelector: {
                                categoryPath?: string;
                                brands?: string[];
                                priceMin?: number;
                                priceMax?: number;
                                productIds?: string[];
                                q?: string;
                            };
                            
                            goal: "click" | "conversion";
                            startsAt: string | null;
                            endsAt: string | null;
                            createdAt: string;
                            creativeCounts: {
                                [key: string]: number;
                            };
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Campaigns_create: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    
                    placement: "home_hero" | "pdp_sidebar" | "cart_upsell" | "category_banner";
                    
                    targetSegments?: string[];
                    
                    productSelector?: {
                        categoryPath?: string;
                        brands?: string[];
                        priceMin?: number;
                        priceMax?: number;
                        productIds?: string[];
                        q?: string;
                    };
                    
                    goal?: "click" | "conversion";
                    startsAt?: string | null;
                    endsAt?: string | null;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        
                        placement: "home_hero" | "pdp_sidebar" | "cart_upsell" | "category_banner";
                        
                        status: "draft" | "active" | "paused" | "ended";
                        targetSegments: string[];
                        productSelector: {
                            categoryPath?: string;
                            brands?: string[];
                            priceMin?: number;
                            priceMax?: number;
                            productIds?: string[];
                            q?: string;
                        };
                        
                        goal: "click" | "conversion";
                        startsAt: string | null;
                        endsAt: string | null;
                        createdAt: string;
                        creativeCounts: {
                            [key: string]: number;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Campaigns_get: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        
                        placement: "home_hero" | "pdp_sidebar" | "cart_upsell" | "category_banner";
                        
                        status: "draft" | "active" | "paused" | "ended";
                        targetSegments: string[];
                        productSelector: {
                            categoryPath?: string;
                            brands?: string[];
                            priceMin?: number;
                            priceMax?: number;
                            productIds?: string[];
                            q?: string;
                        };
                        
                        goal: "click" | "conversion";
                        startsAt: string | null;
                        endsAt: string | null;
                        createdAt: string;
                        creativeCounts: {
                            [key: string]: number;
                        };
                        creatives: {
                            id: string;
                            campaignId: string;
                            headline: string;
                            body: string;
                            cta: string;
                            tone: string | null;
                            targetSegment: string | null;
                            
                            status: "draft" | "approved" | "rejected" | "active" | "paused";
                            
                            source: "llm" | "human";
                            generation: {
                                model?: string;
                                provider?: string;
                                promptVersion?: string;
                                inputHash?: string;
                                latencyMs?: number;
                                tokens?: {
                                    input: number;
                                    output: number;
                                };
                                costUsd?: number;
                                cached?: boolean;
                                rationale?: string;
                                attempts?: number;
                                flagDetails?: string[];
                            } | null;
                            guardrailFlags: string[];
                            reviewedBy: string | null;
                            reviewedAt: string | null;
                            reviewComment: string | null;
                            createdAt: string;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Campaigns_update: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    
                    status?: "draft" | "active" | "paused" | "ended";
                    targetSegments?: string[];
                    productSelector?: {
                        categoryPath?: string;
                        brands?: string[];
                        priceMin?: number;
                        priceMax?: number;
                        productIds?: string[];
                        q?: string;
                    };
                    
                    goal?: "click" | "conversion";
                    startsAt?: string | null;
                    endsAt?: string | null;
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        
                        placement: "home_hero" | "pdp_sidebar" | "cart_upsell" | "category_banner";
                        
                        status: "draft" | "active" | "paused" | "ended";
                        targetSegments: string[];
                        productSelector: {
                            categoryPath?: string;
                            brands?: string[];
                            priceMin?: number;
                            priceMax?: number;
                            productIds?: string[];
                            q?: string;
                        };
                        
                        goal: "click" | "conversion";
                        startsAt: string | null;
                        endsAt: string | null;
                        createdAt: string;
                        creativeCounts: {
                            [key: string]: number;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Campaigns_createCreative: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    headline: string;
                    body: string;
                    cta: string;
                    tone?: ("performance" | "lifestyle" | "value" | "premium") | null;
                    targetSegment?: string | null;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        campaignId: string;
                        headline: string;
                        body: string;
                        cta: string;
                        tone: string | null;
                        targetSegment: string | null;
                        
                        status: "draft" | "approved" | "rejected" | "active" | "paused";
                        
                        source: "llm" | "human";
                        generation: {
                            model?: string;
                            provider?: string;
                            promptVersion?: string;
                            inputHash?: string;
                            latencyMs?: number;
                            tokens?: {
                                input: number;
                                output: number;
                            };
                            costUsd?: number;
                            cached?: boolean;
                            rationale?: string;
                            attempts?: number;
                            flagDetails?: string[];
                        } | null;
                        guardrailFlags: string[];
                        reviewedBy: string | null;
                        reviewedAt: string | null;
                        reviewComment: string | null;
                        createdAt: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Campaigns_generate: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    segments: string[];
                    tones: ("performance" | "lifestyle" | "value" | "premium")[];
                    
                    count?: number;
                    
                    async?: boolean;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        jobId: string;
                        status: string;
                        creatives: {
                            id: string;
                            campaignId: string;
                            headline: string;
                            body: string;
                            cta: string;
                            tone: string | null;
                            targetSegment: string | null;
                            
                            status: "draft" | "approved" | "rejected" | "active" | "paused";
                            
                            source: "llm" | "human";
                            generation: {
                                model?: string;
                                provider?: string;
                                promptVersion?: string;
                                inputHash?: string;
                                latencyMs?: number;
                                tokens?: {
                                    input: number;
                                    output: number;
                                };
                                costUsd?: number;
                                cached?: boolean;
                                rationale?: string;
                                attempts?: number;
                                flagDetails?: string[];
                            } | null;
                            guardrailFlags: string[];
                            reviewedBy: string | null;
                            reviewedAt: string | null;
                            reviewComment: string | null;
                            createdAt: string;
                        }[];
                        errors: string[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Experiments_experiment: {
        parameters: {
            query?: {
                hours?: number;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        campaignId: string;
                        name: string;
                        goal: string;
                        status: string;
                        segments: {
                            segmentKey: string;
                            impressions: number;
                            successes: number;
                            arms: {
                                creativeId: string;
                                headline: string;
                                tone: string | null;
                                status: string;
                                alpha: number;
                                beta: number;
                                impressions: number;
                                successes: number;
                                rate: number;
                                low: number;
                                high: number;
                                pBest: number;
                            }[];
                        }[];
                        holdout: {
                            impressions: number;
                            clicks: number;
                            conversions: number;
                            rate: number;
                        };
                        personalized: {
                            impressions: number;
                            clicks: number;
                            conversions: number;
                            rate: number;
                        };
                        traffic: {
                            
                            interval: "minute" | "hour";
                            points: {
                                t: string;
                                segmentKey: string;
                                creativeId: string;
                                decisions: number;
                            }[];
                        };
                        history: {
                            snapshotAt: string;
                            segmentKey: string;
                            creativeId: string;
                            alpha: number;
                            beta: number;
                        }[];
                        regret: {
                            thompson: number;
                            uniform: number;
                            decisions: number;
                            series: {
                                t: number;
                                thompson: number;
                                uniform: number;
                            }[];
                        } | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Campaigns_preview: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    productSelector: {
                        categoryPath?: string;
                        brands?: string[];
                        priceMin?: number;
                        priceMax?: number;
                        productIds?: string[];
                        q?: string;
                    };
                    
                    limit?: number;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        total: number;
                        products: {
                            id: string;
                            title: string;
                            slug: string;
                            brand: string | null;
                            priceMinCents: number | null;
                            compareAtCents: number | null;
                            currency: string;
                            categoryPath: string | null;
                            imageUrl: string | null;
                            available: boolean;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_categories: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            parentId: string | null;
                            name: string;
                            slug: string;
                            path: string;
                            depth: number;
                            productCount?: number;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_createCategory: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    slug: string;
                    parentId?: string | null;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        parentId: string | null;
                        name: string;
                        slug: string;
                        path: string;
                        depth: number;
                        productCount?: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_deleteCategory: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_updateCategory: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    slug?: string;
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        parentId: string | null;
                        name: string;
                        slug: string;
                        path: string;
                        depth: number;
                        productCount?: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Creatives_update: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    headline?: string;
                    body?: string;
                    cta?: string;
                    tone?: ("performance" | "lifestyle" | "value" | "premium") | null;
                    
                    status?: "active" | "paused";
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        campaignId: string;
                        headline: string;
                        body: string;
                        cta: string;
                        tone: string | null;
                        targetSegment: string | null;
                        
                        status: "draft" | "approved" | "rejected" | "active" | "paused";
                        
                        source: "llm" | "human";
                        generation: {
                            model?: string;
                            provider?: string;
                            promptVersion?: string;
                            inputHash?: string;
                            latencyMs?: number;
                            tokens?: {
                                input: number;
                                output: number;
                            };
                            costUsd?: number;
                            cached?: boolean;
                            rationale?: string;
                            attempts?: number;
                            flagDetails?: string[];
                        } | null;
                        guardrailFlags: string[];
                        reviewedBy: string | null;
                        reviewedAt: string | null;
                        reviewComment: string | null;
                        createdAt: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Creatives_review: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    decision: "approve" | "reject";
                    comment?: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        campaignId: string;
                        headline: string;
                        body: string;
                        cta: string;
                        tone: string | null;
                        targetSegment: string | null;
                        
                        status: "draft" | "approved" | "rejected" | "active" | "paused";
                        
                        source: "llm" | "human";
                        generation: {
                            model?: string;
                            provider?: string;
                            promptVersion?: string;
                            inputHash?: string;
                            latencyMs?: number;
                            tokens?: {
                                input: number;
                                output: number;
                            };
                            costUsd?: number;
                            cached?: boolean;
                            rationale?: string;
                            attempts?: number;
                            flagDetails?: string[];
                        } | null;
                        guardrailFlags: string[];
                        reviewedBy: string | null;
                        reviewedAt: string | null;
                        reviewComment: string | null;
                        createdAt: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Creatives_queue: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            campaignId: string;
                            headline: string;
                            body: string;
                            cta: string;
                            tone: string | null;
                            targetSegment: string | null;
                            
                            status: "draft" | "approved" | "rejected" | "active" | "paused";
                            
                            source: "llm" | "human";
                            generation: {
                                model?: string;
                                provider?: string;
                                promptVersion?: string;
                                inputHash?: string;
                                latencyMs?: number;
                                tokens?: {
                                    input: number;
                                    output: number;
                                };
                                costUsd?: number;
                                cached?: boolean;
                                rationale?: string;
                                attempts?: number;
                                flagDetails?: string[];
                            } | null;
                            guardrailFlags: string[];
                            reviewedBy: string | null;
                            reviewedAt: string | null;
                            reviewComment: string | null;
                            createdAt: string;
                            campaignName: string;
                            placement: string;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Customers_list: {
        parameters: {
            query?: {
                q?: string;
                limit?: number;
                cursor?: string;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            email: string;
                            name: string | null;
                            registered: boolean;
                            ordersCount: number;
                            ltvCents: number;
                            createdAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Customers_detail: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        name: string | null;
                        registered: boolean;
                        ordersCount: number;
                        ltvCents: number;
                        createdAt: string;
                        anonymousIds: string[];
                        orders: {
                            id: string;
                            number: number;
                            email: string;
                            customerId: string | null;
                            
                            status: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                            currency: string;
                            totalCents: number;
                            itemsCount: number;
                            placedAt: string;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Customers_profile: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        profileId: string | null;
                        customerId: string | null;
                        
                        source: "live" | "snapshot" | "none";
                        features: {
                            [key: string]: unknown;
                        };
                        affinity: {
                            categories: {
                                key: string;
                                score: number;
                            }[];
                            brands: {
                                key: string;
                                score: number;
                            }[];
                            tones: {
                                key: string;
                                score: number;
                            }[];
                        };
                        priceBand: string | null;
                        priceEwmaCents: number | null;
                        intent: number;
                        segments: {
                            key: string;
                            name: string;
                            priority: number;
                            reasons: string[];
                        }[];
                        signals: string[];
                        recentProducts: string[];
                        updatedAt: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Customers_timeline: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Experiments_decision: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                decisionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Discounts_list: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            code: string;
                            
                            type: "percent" | "fixed";
                            value: number;
                            minSubtotalCents: number;
                            startsAt: string | null;
                            endsAt: string | null;
                            usageLimit: number | null;
                            perCustomerLimit: number | null;
                            usedCount: number;
                            active: boolean;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Discounts_create: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
                    
                    type: "percent" | "fixed";
                    value: number;
                    
                    minSubtotalCents?: number;
                    startsAt?: string | null;
                    endsAt?: string | null;
                    usageLimit?: number | null;
                    perCustomerLimit?: number | null;
                    
                    active?: boolean;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        code: string;
                        
                        type: "percent" | "fixed";
                        value: number;
                        minSubtotalCents: number;
                        startsAt: string | null;
                        endsAt: string | null;
                        usageLimit: number | null;
                        perCustomerLimit: number | null;
                        usedCount: number;
                        active: boolean;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Discounts_remove: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Discounts_update: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code?: string;
                    
                    type?: "percent" | "fixed";
                    value?: number;
                    
                    minSubtotalCents?: number;
                    startsAt?: string | null;
                    endsAt?: string | null;
                    usageLimit?: number | null;
                    perCustomerLimit?: number | null;
                    
                    active?: boolean;
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        code: string;
                        
                        type: "percent" | "fixed";
                        value: number;
                        minSubtotalCents: number;
                        startsAt: string | null;
                        endsAt: string | null;
                        usageLimit: number | null;
                        perCustomerLimit: number | null;
                        usedCount: number;
                        active: boolean;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Creatives_features: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        aiCreatives: boolean;
                        flags: {
                            source: string;
                            initialized: boolean;
                            relay: string | null;
                        };
                        llm: {
                            provider: string;
                            model: string;
                            usedToday: number;
                            dailyLimit: number;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Inventory_list: {
        parameters: {
            query?: {
                q?: string;
                lowStock?: "true" | "false";
                limit?: number;
                cursor?: string;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            variantId: string;
                            productId: string;
                            productTitle: string;
                            sku: string;
                            variantTitle: string;
                            onHand: number;
                            reserved: number;
                            available: number;
                            lowStock: boolean;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Inventory_adjust: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                variantId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    delta: number;
                    reason: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Inventory_movements: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                variantId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            delta: number;
                            reason: string;
                            referenceId: string | null;
                            actorId: string | null;
                            createdAt: string;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Team_invitations: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            email: string;
                            role: string;
                            expiresAt: string;
                            acceptedAt: string | null;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Team_invite: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    email: string;
                    
                    role: "admin" | "catalog_manager" | "marketer" | "support";
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        role: string;
                        expiresAt: string;
                        acceptedAt: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Team_revoke: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Jobs_get: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        type: string;
                        
                        status: "queued" | "running" | "completed" | "failed";
                        total: number;
                        processed: number;
                        failed: number;
                        errors: {
                            row: number;
                            message: string;
                        }[];
                        result: {
                            [key: string]: unknown;
                        } | null;
                        createdAt: string;
                        finishedAt: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Team_members: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            userId: string;
                            email: string;
                            name: string;
                            
                            role: "owner" | "admin" | "catalog_manager" | "marketer" | "support";
                            createdAt: string;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Team_remove: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Team_update: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    role: "owner" | "admin" | "catalog_manager" | "marketer" | "support";
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Orders_list: {
        parameters: {
            query?: {
                status?: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                from?: string;
                to?: string;
                customerId?: string;
                email?: string;
                number?: number;
                minTotal?: number;
                maxTotal?: number;
                limit?: number;
                cursor?: string;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            number: number;
                            email: string;
                            customerId: string | null;
                            
                            status: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                            currency: string;
                            totalCents: number;
                            itemsCount: number;
                            placedAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Orders_detail: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        number: number;
                        email: string;
                        customerId: string | null;
                        
                        status: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                        currency: string;
                        totalCents: number;
                        itemsCount: number;
                        placedAt: string;
                        subtotalCents: number;
                        discountCents: number;
                        shippingCents: number;
                        discountCode: string | null;
                        shippingAddress: {
                            [key: string]: unknown;
                        };
                        attribution: {
                            [key: string]: unknown;
                        } | null;
                        items: {
                            id: string;
                            variantId: string;
                            productId: string;
                            title: string;
                            sku: string;
                            unitPriceCents: number;
                            quantity: number;
                        }[];
                        history: {
                            id: string;
                            fromStatus: string | null;
                            toStatus: string;
                            reason: string | null;
                            actorId: string | null;
                            createdAt: string;
                        }[];
                        payments: {
                            id: string;
                            provider: string;
                            providerRef: string;
                            status: string;
                            amountCents: number;
                            createdAt: string;
                        }[];
                        allowedTransitions: ("pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed")[];
                        refundable: boolean;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Orders_refund: {
        parameters: {
            query?: never;
            header: {
                
                "Idempotency-Key": string;
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason?: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        orderId: string;
                        
                        status: "refunded";
                        amountCents: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Orders_transition: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    to: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                    note?: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        number: number;
                        email: string;
                        customerId: string | null;
                        
                        status: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                        currency: string;
                        totalCents: number;
                        itemsCount: number;
                        placedAt: string;
                        subtotalCents: number;
                        discountCents: number;
                        shippingCents: number;
                        discountCode: string | null;
                        shippingAddress: {
                            [key: string]: unknown;
                        };
                        attribution: {
                            [key: string]: unknown;
                        } | null;
                        items: {
                            id: string;
                            variantId: string;
                            productId: string;
                            title: string;
                            sku: string;
                            unitPriceCents: number;
                            quantity: number;
                        }[];
                        history: {
                            id: string;
                            fromStatus: string | null;
                            toStatus: string;
                            reason: string | null;
                            actorId: string | null;
                            createdAt: string;
                        }[];
                        payments: {
                            id: string;
                            provider: string;
                            providerRef: string;
                            status: string;
                            amountCents: number;
                            createdAt: string;
                        }[];
                        allowedTransitions: ("pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed")[];
                        refundable: boolean;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_products: {
        parameters: {
            query?: {
                q?: string;
                status?: "draft" | "active" | "archived";
                categoryId?: string;
                lowStock?: "true" | "false";
                sort?: "-updated_at" | "updated_at" | "title" | "-title" | "price" | "-price";
                limit?: number;
                cursor?: string;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            title: string;
                            slug: string;
                            brand: string | null;
                            
                            status: "draft" | "active" | "archived";
                            categoryId: string | null;
                            categoryName: string | null;
                            priceMinCents: number | null;
                            currency: string;
                            totalAvailable: number;
                            variantCount: number;
                            imageUrl: string | null;
                            updatedAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_create: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    slug?: string;
                    
                    description?: string;
                    brand?: string | null;
                    
                    status?: "draft" | "active" | "archived";
                    categoryId?: string | null;
                    
                    attributes?: {
                        [key: string]: unknown;
                    };
                    
                    tags?: string[];
                    variants: {
                        id?: string;
                        sku: string;
                        title: string;
                        priceCents: number;
                        compareAtCents?: number | null;
                        
                        attributes?: {
                            [key: string]: string;
                        };
                        
                        onHand?: number;
                    }[];
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        title: string;
                        slug: string;
                        description: string;
                        brand: string | null;
                        
                        status: "draft" | "active" | "archived";
                        categoryId: string | null;
                        categoryPath: string | null;
                        categoryName: string | null;
                        attributes: {
                            [key: string]: unknown;
                        };
                        tags: string[];
                        priceMinCents: number | null;
                        currency: string;
                        images: {
                            id: string;
                            url: string;
                            storageKey: string;
                            position: number;
                            alt: string | null;
                        }[];
                        variants: {
                            id: string;
                            sku: string;
                            title: string;
                            priceCents: number;
                            compareAtCents: number | null;
                            currency: string;
                            attributes: {
                                [key: string]: string;
                            };
                            onHand: number;
                            reserved: number;
                            available: number;
                        }[];
                        createdAt: string;
                        updatedAt: string;
                        version: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_get: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        title: string;
                        slug: string;
                        description: string;
                        brand: string | null;
                        
                        status: "draft" | "active" | "archived";
                        categoryId: string | null;
                        categoryPath: string | null;
                        categoryName: string | null;
                        attributes: {
                            [key: string]: unknown;
                        };
                        tags: string[];
                        priceMinCents: number | null;
                        currency: string;
                        images: {
                            id: string;
                            url: string;
                            storageKey: string;
                            position: number;
                            alt: string | null;
                        }[];
                        variants: {
                            id: string;
                            sku: string;
                            title: string;
                            priceCents: number;
                            compareAtCents: number | null;
                            currency: string;
                            attributes: {
                                [key: string]: string;
                            };
                            onHand: number;
                            reserved: number;
                            available: number;
                        }[];
                        createdAt: string;
                        updatedAt: string;
                        version: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_remove: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_update: {
        parameters: {
            query?: never;
            header: {
                
                "If-Match": string;
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title?: string;
                    slug?: string;
                    description?: string;
                    brand?: string | null;
                    
                    status?: "draft" | "active" | "archived";
                    categoryId?: string | null;
                    attributes?: {
                        [key: string]: unknown;
                    };
                    tags?: string[];
                    variants?: {
                        id?: string;
                        sku: string;
                        title: string;
                        priceCents: number;
                        compareAtCents?: number | null;
                        
                        attributes?: {
                            [key: string]: string;
                        };
                        
                        onHand?: number;
                    }[];
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        title: string;
                        slug: string;
                        description: string;
                        brand: string | null;
                        
                        status: "draft" | "active" | "archived";
                        categoryId: string | null;
                        categoryPath: string | null;
                        categoryName: string | null;
                        attributes: {
                            [key: string]: unknown;
                        };
                        tags: string[];
                        priceMinCents: number | null;
                        currency: string;
                        images: {
                            id: string;
                            url: string;
                            storageKey: string;
                            position: number;
                            alt: string | null;
                        }[];
                        variants: {
                            id: string;
                            sku: string;
                            title: string;
                            priceCents: number;
                            compareAtCents: number | null;
                            currency: string;
                            attributes: {
                                [key: string]: string;
                            };
                            onHand: number;
                            reserved: number;
                            available: number;
                        }[];
                        createdAt: string;
                        updatedAt: string;
                        version: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_upload: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    filename: string;
                    
                    contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/svg+xml";
                    alt?: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        image: {
                            id: string;
                            url: string;
                            storageKey: string;
                            position: number;
                            alt: string | null;
                        };
                        uploadUrl: string;
                        
                        method: "PUT";
                        headers: {
                            [key: string]: string;
                        };
                        expiresIn: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_deleteImage: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
                imageId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_reorder: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    imageIds: string[];
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        title: string;
                        slug: string;
                        description: string;
                        brand: string | null;
                        
                        status: "draft" | "active" | "archived";
                        categoryId: string | null;
                        categoryPath: string | null;
                        categoryName: string | null;
                        attributes: {
                            [key: string]: unknown;
                        };
                        tags: string[];
                        priceMinCents: number | null;
                        currency: string;
                        images: {
                            id: string;
                            url: string;
                            storageKey: string;
                            position: number;
                            alt: string | null;
                        }[];
                        variants: {
                            id: string;
                            sku: string;
                            title: string;
                            priceCents: number;
                            compareAtCents: number | null;
                            currency: string;
                            attributes: {
                                [key: string]: string;
                            };
                            onHand: number;
                            reserved: number;
                            available: number;
                        }[];
                        createdAt: string;
                        updatedAt: string;
                        version: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogAdmin_importProducts: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        jobId: string;
                        status: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Profiles_get: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        profileId: string | null;
                        customerId: string | null;
                        
                        source: "live" | "snapshot" | "none";
                        features: {
                            [key: string]: unknown;
                        };
                        affinity: {
                            categories: {
                                key: string;
                                score: number;
                            }[];
                            brands: {
                                key: string;
                                score: number;
                            }[];
                            tones: {
                                key: string;
                                score: number;
                            }[];
                        };
                        priceBand: string | null;
                        priceEwmaCents: number | null;
                        intent: number;
                        segments: {
                            key: string;
                            name: string;
                            priority: number;
                            reasons: string[];
                        }[];
                        signals: string[];
                        recentProducts: string[];
                        updatedAt: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Analytics_ticket: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ticket: string;
                        url: string;
                        expiresIn: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Segments_list: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            key: string;
                            name: string;
                            rules: {
                                [key: string]: unknown;
                            };
                            description: string;
                            priority: number;
                            isSystem: boolean;
                            members: number;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Segments_create: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    key: string;
                    name: string;
                    
                    rules: {
                        [key: string]: unknown;
                    };
                    
                    priority?: number;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        key: string;
                        name: string;
                        rules: {
                            [key: string]: unknown;
                        };
                        description: string;
                        priority: number;
                        isSystem: boolean;
                        members: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Segments_remove: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Segments_update: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    
                    rules?: {
                        [key: string]: unknown;
                    };
                    priority?: number;
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        key: string;
                        name: string;
                        rules: {
                            [key: string]: unknown;
                        };
                        description: string;
                        priority: number;
                        isSystem: boolean;
                        members: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Segments_features: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        features: {
                            name: string;
                            kind: string;
                            help: string;
                        }[];
                        categories: string[];
                        brands: string[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Segments_preview: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    rules: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        count: number;
                        total: number;
                        description: string;
                        sample: {
                            profileId: string;
                            customerId: string | null;
                            reasons: string[];
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Settings_get: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        name: string;
                        slug: string;
                        currency: string;
                        lowStockThreshold: number;
                        brandColor: string;
                        tagline: string;
                        trackingKey: string | null;
                        language: string;
                        brandVoice: string;
                        bannedClaims: string[];
                        aiCreativesDailyLimit: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Settings_update: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    lowStockThreshold?: number;
                    brandColor?: string;
                    tagline?: string;
                    language?: string;
                    brandVoice?: string;
                    bannedClaims?: string[];
                    aiCreativesDailyLimit?: number;
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        name: string;
                        slug: string;
                        currency: string;
                        lowStockThreshold: number;
                        brandColor: string;
                        tagline: string;
                        trackingKey: string | null;
                        language: string;
                        brandVoice: string;
                        bannedClaims: string[];
                        aiCreativesDailyLimit: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Webhooks_list: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            url: string;
                            events: ("order.paid" | "order.refunded")[];
                            
                            status: "active" | "disabled";
                            secretPrefix: string;
                            description: string | null;
                            createdAt: string;
                            disabledAt: string | null;
                            lastDeliveryAt: string | null;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Webhooks_create: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    url: string;
                    events: ("order.paid" | "order.refunded")[];
                    description?: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        url: string;
                        events: ("order.paid" | "order.refunded")[];
                        
                        status: "active" | "disabled";
                        secretPrefix: string;
                        description: string | null;
                        createdAt: string;
                        disabledAt: string | null;
                        lastDeliveryAt: string | null;
                        secret: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Webhooks_remove: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Webhooks_update: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    url?: string;
                    events?: ("order.paid" | "order.refunded")[];
                    
                    status?: "active" | "disabled";
                    description?: string | null;
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        url: string;
                        events: ("order.paid" | "order.refunded")[];
                        
                        status: "active" | "disabled";
                        secretPrefix: string;
                        description: string | null;
                        createdAt: string;
                        disabledAt: string | null;
                        lastDeliveryAt: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Webhooks_deliveries: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            endpointId: string;
                            eventId: string;
                            eventType: string;
                            
                            status: "pending" | "succeeded" | "failed" | "dead";
                            attempts: number;
                            nextAttemptAt: string | null;
                            lastStatusCode: number | null;
                            lastError: string | null;
                            durationMs: number | null;
                            createdAt: string;
                            deliveredAt: string | null;
                            payload: {
                                [key: string]: unknown;
                            };
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Webhooks_resend: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Tenant-Id"?: string;
            };
            path: {
                deliveryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        endpointId: string;
                        eventId: string;
                        eventType: string;
                        
                        status: "pending" | "succeeded" | "failed" | "dead";
                        attempts: number;
                        nextAttemptAt: string | null;
                        lastStatusCode: number | null;
                        lastError: string | null;
                        durationMs: number | null;
                        createdAt: string;
                        deliveredAt: string | null;
                        payload: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Auth_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    email: string;
                    password: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        expiresIn: number;
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            isPlatformAdmin: boolean;
                        };
                        memberships: {
                            tenantId: string;
                            slug: string;
                            name: string;
                            
                            role: "owner" | "admin" | "catalog_manager" | "marketer" | "support";
                            permissions: ("catalog:read" | "catalog:write" | "inventory:write" | "orders:read" | "orders:manage" | "customers:read" | "marketing:write" | "marketing:approve" | "analytics:read" | "staff:manage" | "apikeys:manage" | "settings:write")[];
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Auth_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Auth_refresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        expiresIn: number;
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            isPlatformAdmin: boolean;
                        };
                        memberships: {
                            tenantId: string;
                            slug: string;
                            name: string;
                            
                            role: "owner" | "admin" | "catalog_manager" | "marketer" | "support";
                            permissions: ("catalog:read" | "catalog:write" | "inventory:write" | "orders:read" | "orders:manage" | "customers:read" | "marketing:write" | "marketing:approve" | "analytics:read" | "staff:manage" | "apikeys:manage" | "settings:write")[];
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Auth_signup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    email: string;
                    password: string;
                    name: string;
                    storeName: string;
                    storeSlug: string;
                    
                    currency?: string;
                    
                    demoCatalog?: boolean;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        expiresIn: number;
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            isPlatformAdmin: boolean;
                        };
                        memberships: {
                            tenantId: string;
                            slug: string;
                            name: string;
                            
                            role: "owner" | "admin" | "catalog_manager" | "marketer" | "support";
                            permissions: ("catalog:read" | "catalog:write" | "inventory:write" | "orders:read" | "orders:manage" | "customers:read" | "marketing:write" | "marketing:approve" | "analytics:read" | "staff:manage" | "apikeys:manage" | "settings:write")[];
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Team_accept: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    password: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        expiresIn: number;
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            isPlatformAdmin: boolean;
                        };
                        memberships: {
                            tenantId: string;
                            slug: string;
                            name: string;
                            
                            role: "owner" | "admin" | "catalog_manager" | "marketer" | "support";
                            permissions: ("catalog:read" | "catalog:write" | "inventory:write" | "orders:read" | "orders:manage" | "customers:read" | "marketing:write" | "marketing:approve" | "analytics:read" | "staff:manage" | "apikeys:manage" | "settings:write")[];
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Auth_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            isPlatformAdmin: boolean;
                        };
                        memberships: {
                            tenantId: string;
                            slug: string;
                            name: string;
                            
                            role: "owner" | "admin" | "catalog_manager" | "marketer" | "support";
                            permissions: ("catalog:read" | "catalog:write" | "inventory:write" | "orders:read" | "orders:manage" | "customers:read" | "marketing:write" | "marketing:approve" | "analytics:read" | "staff:manage" | "apikeys:manage" | "settings:write")[];
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Payments_confirm: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path: {
                intentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    cardNumber: string;
                };
            };
        };
        responses: {
            
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        intentId: string;
                        
                        status: "processing";
                        orderId: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Payments_webhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        received: boolean;
                        duplicate: boolean;
                        outcome: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Platform_dlq: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            queue: string;
                            source: string;
                            messages: number;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Platform_peek: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path: {
                queue: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            messageId: string;
                            routingKey: string;
                            exchange: string;
                            headers: {
                                [key: string]: unknown;
                            };
                            error: string | null;
                            retryCount: number;
                            body: unknown;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Platform_replay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                queue: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    messageIds: string[] | "all";
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        replayed: number;
                        remaining: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Simulator_state: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        running: boolean;
                        rate: number;
                        personas: {
                            [key: string]: number;
                        };
                        shifted: {
                            [key: string]: {
                                [key: string]: number;
                            };
                        };
                        mode: string;
                        updatedAt: string | null;
                        stats: {
                            [key: string]: number;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Simulator_command: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    action: "start" | "stop" | "shift" | "reset_shift";
                    rate?: number;
                    personas?: {
                        [key: string]: number;
                    };
                    shift?: {
                        persona: string;
                        toneMultipliers: {
                            [key: string]: number;
                        };
                    };
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        running: boolean;
                        rate: number;
                        personas: {
                            [key: string]: number;
                        };
                        shifted: {
                            [key: string]: {
                                [key: string]: number;
                            };
                        };
                        mode: string;
                        updatedAt: string | null;
                        stats: {
                            [key: string]: number;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Simulator_groundTruth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        campaignId: string | null;
                        campaignName: string | null;
                        rows: {
                            persona: string;
                            trueBestTone: string;
                            toneMultipliers: {
                                [key: string]: number;
                            };
                            sessions: number;
                            segmentKey: string | null;
                            segmentShare: number;
                            learnedTone: string | null;
                            pBest: number | null;
                            impressions: number;
                            correct: boolean;
                        }[];
                        regret: {
                            thompson: number;
                            uniform: number;
                            decisions: number;
                        } | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Platform_tenants: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            slug: string;
                            name: string;
                            status: string;
                            createdAt: string;
                            members: number;
                            products: number;
                            orders: number;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CustomerAuth_me: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        name: string | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Orders_accountOrders: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            number: number;
                            email: string;
                            customerId: string | null;
                            
                            status: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                            currency: string;
                            totalCents: number;
                            itemsCount: number;
                            placedAt: string;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CustomerAuth_login: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    email: string;
                    password: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        expiresIn: number;
                        customer: {
                            id: string;
                            email: string;
                            name: string | null;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CustomerAuth_logout: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CustomerAuth_refresh: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        expiresIn: number;
                        customer: {
                            id: string;
                            email: string;
                            name: string | null;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CustomerAuth_register: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    email: string;
                    password: string;
                    name: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        expiresIn: number;
                        customer: {
                            id: string;
                            email: string;
                            name: string | null;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Cart_get: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string | null;
                        currency: string;
                        items: {
                            variantId: string;
                            productId: string;
                            productTitle: string;
                            productSlug: string;
                            variantTitle: string;
                            sku: string;
                            imageUrl: string | null;
                            categoryPath: string | null;
                            quantity: number;
                            unitPriceCents: number;
                            previousUnitPriceCents: number | null;
                            priceChanged: boolean;
                            lineTotalCents: number;
                            available: number;
                        }[];
                        itemsCount: number;
                        subtotalCents: number;
                        discountCode: string | null;
                        discountCents: number;
                        discountError: string | null;
                        totalCents: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Cart_discount: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string | null;
                        currency: string;
                        items: {
                            variantId: string;
                            productId: string;
                            productTitle: string;
                            productSlug: string;
                            variantTitle: string;
                            sku: string;
                            imageUrl: string | null;
                            categoryPath: string | null;
                            quantity: number;
                            unitPriceCents: number;
                            previousUnitPriceCents: number | null;
                            priceChanged: boolean;
                            lineTotalCents: number;
                            available: number;
                        }[];
                        itemsCount: number;
                        subtotalCents: number;
                        discountCode: string | null;
                        discountCents: number;
                        discountError: string | null;
                        totalCents: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Cart_removeDiscount: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string | null;
                        currency: string;
                        items: {
                            variantId: string;
                            productId: string;
                            productTitle: string;
                            productSlug: string;
                            variantTitle: string;
                            sku: string;
                            imageUrl: string | null;
                            categoryPath: string | null;
                            quantity: number;
                            unitPriceCents: number;
                            previousUnitPriceCents: number | null;
                            priceChanged: boolean;
                            lineTotalCents: number;
                            available: number;
                        }[];
                        itemsCount: number;
                        subtotalCents: number;
                        discountCode: string | null;
                        discountCents: number;
                        discountError: string | null;
                        totalCents: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Cart_add: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    variantId: string;
                    quantity: number;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string | null;
                        currency: string;
                        items: {
                            variantId: string;
                            productId: string;
                            productTitle: string;
                            productSlug: string;
                            variantTitle: string;
                            sku: string;
                            imageUrl: string | null;
                            categoryPath: string | null;
                            quantity: number;
                            unitPriceCents: number;
                            previousUnitPriceCents: number | null;
                            priceChanged: boolean;
                            lineTotalCents: number;
                            available: number;
                        }[];
                        itemsCount: number;
                        subtotalCents: number;
                        discountCode: string | null;
                        discountCents: number;
                        discountError: string | null;
                        totalCents: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Cart_remove: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path: {
                variantId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string | null;
                        currency: string;
                        items: {
                            variantId: string;
                            productId: string;
                            productTitle: string;
                            productSlug: string;
                            variantTitle: string;
                            sku: string;
                            imageUrl: string | null;
                            categoryPath: string | null;
                            quantity: number;
                            unitPriceCents: number;
                            previousUnitPriceCents: number | null;
                            priceChanged: boolean;
                            lineTotalCents: number;
                            available: number;
                        }[];
                        itemsCount: number;
                        subtotalCents: number;
                        discountCode: string | null;
                        discountCents: number;
                        discountError: string | null;
                        totalCents: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Cart_update: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path: {
                variantId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    quantity: number;
                };
            };
        };
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string | null;
                        currency: string;
                        items: {
                            variantId: string;
                            productId: string;
                            productTitle: string;
                            productSlug: string;
                            variantTitle: string;
                            sku: string;
                            imageUrl: string | null;
                            categoryPath: string | null;
                            quantity: number;
                            unitPriceCents: number;
                            previousUnitPriceCents: number | null;
                            priceChanged: boolean;
                            lineTotalCents: number;
                            available: number;
                        }[];
                        itemsCount: number;
                        subtotalCents: number;
                        discountCode: string | null;
                        discountCents: number;
                        discountError: string | null;
                        totalCents: number;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogStorefront_categories: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            parentId: string | null;
                            name: string;
                            slug: string;
                            path: string;
                            depth: number;
                            productCount?: number;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogStorefront_products: {
        parameters: {
            query?: {
                category?: string;
                q?: string;
                sort?: "relevance" | "newest" | "price_asc" | "price_desc";
                priceMin?: number;
                priceMax?: number;
                brand?: string;
                limit?: number;
                cursor?: string;
            };
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: string;
                            title: string;
                            slug: string;
                            brand: string | null;
                            priceMinCents: number | null;
                            compareAtCents: number | null;
                            currency: string;
                            categoryPath: string | null;
                            imageUrl: string | null;
                            available: boolean;
                        }[];
                        nextCursor: string | null;
                        facets: {
                            brands: {
                                value: string;
                                count: number;
                            }[];
                            priceRange: {
                                min: number | null;
                                max: number | null;
                            };
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogStorefront_product: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        title: string;
                        slug: string;
                        description: string;
                        brand: string | null;
                        
                        status: "draft" | "active" | "archived";
                        categoryId: string | null;
                        categoryPath: string | null;
                        categoryName: string | null;
                        attributes: {
                            [key: string]: unknown;
                        };
                        tags: string[];
                        priceMinCents: number | null;
                        currency: string;
                        images: {
                            id: string;
                            url: string;
                            storageKey: string;
                            position: number;
                            alt: string | null;
                        }[];
                        variants: {
                            id: string;
                            sku: string;
                            title: string;
                            priceCents: number;
                            compareAtCents: number | null;
                            currency: string;
                            attributes: {
                                [key: string]: string;
                            };
                            onHand: number;
                            reserved: number;
                            available: number;
                        }[];
                        createdAt: string;
                        updatedAt: string;
                        version: string;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Checkout_place: {
        parameters: {
            query?: never;
            header: {
                
                "Idempotency-Key": string;
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    
                    email: string;
                    shippingAddress: {
                        name: string;
                        line1: string;
                        line2?: string;
                        city: string;
                        postalCode: string;
                        country: string;
                    };
                    
                    shippingMethod: "standard" | "express";
                    discountCode?: string | null;
                };
            };
        };
        responses: {
            
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        orderId: string;
                        number: number;
                        
                        status: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                        totalCents: number;
                        currency: string;
                        payment: {
                            provider: string;
                            intentId: string;
                            clientSecret: string;
                        };
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Decisions_decide: {
        parameters: {
            query: {
                placement: "home_hero" | "pdp_sidebar" | "cart_upsell" | "category_banner";
                productId?: string;
                limit?: number;
            };
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        decisionId: string;
                        
                        placement: "home_hero" | "pdp_sidebar" | "cart_upsell" | "category_banner";
                        campaignId: string;
                        creativeId: string;
                        segmentKey: string;
                        policy: string;
                        creative: {
                            headline: string;
                            body: string;
                            cta: string;
                            tone: string | null;
                        };
                        products: {
                            id: string;
                            title: string;
                            slug: string;
                            brand: string | null;
                            priceMinCents: number | null;
                            compareAtCents: number | null;
                            currency: string;
                            categoryPath: string | null;
                            imageUrl: string | null;
                            available: boolean;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Decisions_explanation: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        decisionId: string;
                        placement: string;
                        decidedAt: string;
                        segment: {
                            key: string;
                            name: string;
                            matchedRules: string[];
                        };
                        otherSegments: string[];
                        profileSignals: string[];
                        coldStart: boolean;
                        creative: {
                            chosen: string;
                            headline: string;
                            tone: string | null;
                            policy: string;
                            arms: {
                                id: string;
                                tone: string | null;
                                headline: string;
                                impressions: number;
                                ctr: number;
                                sampled: number | null;
                                pBest: number;
                            }[];
                        };
                        products: {
                            id: string;
                            title?: string;
                            score: number;
                            strategies: string[];
                            contributions: {
                                similarity: number;
                                affinity: number;
                                popularity: number;
                                priceFit: number;
                                freshness: number;
                            };
                        }[];
                        text: string[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Orders_publicOrder: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        number: number;
                        
                        status: "pending_payment" | "paid" | "fulfilled" | "delivered" | "cancelled" | "refunded" | "payment_failed";
                        currency: string;
                        subtotalCents: number;
                        discountCents: number;
                        shippingCents: number;
                        totalCents: number;
                        email: string;
                        placedAt: string;
                        items: {
                            id: string;
                            variantId: string;
                            productId: string;
                            title: string;
                            sku: string;
                            unitPriceCents: number;
                            quantity: number;
                        }[];
                        payment: {
                            provider: string;
                            intentId: string;
                            clientSecret: string;
                        } | null;
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Recommendations_get: {
        parameters: {
            query?: {
                type?: "for_you" | "similar" | "bought_together" | "cart_upsell";
                productId?: string;
                limit?: number;
            };
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        decisionId: string;
                        
                        type: "for_you" | "similar" | "bought_together" | "cart_upsell";
                        coldStart: boolean;
                        cached: boolean;
                        items: {
                            id: string;
                            title: string;
                            slug: string;
                            brand: string | null;
                            priceMinCents: number | null;
                            compareAtCents: number | null;
                            currency: string;
                            categoryPath: string | null;
                            imageUrl: string | null;
                            available: boolean;
                            score: number;
                            strategies: string[];
                            contributions: {
                                similarity: number;
                                affinity: number;
                                popularity: number;
                                priceFit: number;
                                freshness: number;
                            };
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    CatalogStorefront_suggest: {
        parameters: {
            query?: {
                q?: string;
            };
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        query: string;
                        products: {
                            id: string;
                            title: string;
                            slug: string;
                            score: number;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
    Settings_store: {
        parameters: {
            query?: never;
            header?: {
                
                "X-Store"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        slug: string;
                        name: string;
                        currency: string;
                        brandColor: string;
                        tagline: string;
                        trackingKey: string | null;
                        collectorUrl: string;
                        paymentProvider: string;
                        shippingMethods: {
                            id: string;
                            label: string;
                            cents: number;
                            freeOverCents: number | null;
                        }[];
                    };
                };
            };
            
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": {
                        type: string;
                        title: string;
                        status: number;
                        code: string;
                        detail?: string;
                        instance?: string;
                        traceId?: string;
                        errors?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
    };
}
