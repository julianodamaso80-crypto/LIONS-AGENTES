import logging
from typing import Any, Dict, List
from uuid import UUID

from fastapi import HTTPException
from slugify import slugify

from app.core import get_supabase_client
from app.models.agent import AgentCreate, AgentResponse, AgentUpdate

logger = logging.getLogger(__name__)

class AgentService:
    def __init__(self):
        self.supabase = get_supabase_client()

    def create_agent(self, company_id: UUID, agent_data: AgentCreate) -> AgentResponse:
        try:
            slug = slugify(agent_data.slug or agent_data.name)
            data = agent_data.model_dump(exclude_unset=True)
            data["company_id"] = str(company_id)
            data["slug"] = slug

            # Insert into DB
            result = self.supabase.client.table("agents").insert(data).execute()

            if not result.data:
                raise Exception("Failed to create agent")

            return self._map_to_response(result.data[0])

        except Exception as e:
            logger.error(f"Error creating agent: {e}")
            raise HTTPException(status_code=500, detail=str(e)) from e

    def get_agents_by_company(self, company_id: UUID) -> List[AgentResponse]:
        try:
            result = (
                self.supabase.client.table("agents")
                .select("*")
                .eq("company_id", str(company_id))
                .eq("is_active", True)
                .order("created_at", desc=True)
                .execute()
            )
            return [self._map_to_response(agent) for agent in result.data]
        except Exception as e:
            logger.error(f"Error fetching agents: {e}")
            raise HTTPException(status_code=500, detail=str(e)) from e

    def get_agent_by_id(self, agent_id: str):
        try:
            result = (
                self.supabase.client.table("agents")
                .select("*")
                .eq("id", str(agent_id))
                .single()
                .execute()
            )

            if not result.data:
                return None

            return self._map_to_response(result.data)

        except Exception as e:
            logger.error(f"[AgentService] Erro ao buscar agente: {e}")
            return None

    def update_agent(self, agent_id: UUID, agent_data: AgentUpdate) -> AgentResponse:
        try:
            update_data = agent_data.model_dump(exclude_unset=True)

            if update_data.get("name") or update_data.get("slug"):
                name_ref = update_data.get("slug") or update_data.get("name")
                if name_ref:
                    update_data["slug"] = slugify(name_ref)

            result = (
                self.supabase.client.table("agents")
                .update(update_data)
                .eq("id", str(agent_id))
                .execute()
            )

            if not result.data:
                raise Exception("Failed to update agent")

            return self._map_to_response(result.data[0])

        except Exception as e:
            logger.error(f"Error updating agent {agent_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e)) from e

    def delete_agent(self, agent_id: UUID):
        try:
            # Soft delete
            result = (
                self.supabase.client.table("agents")
                .update({"is_active": False})
                .eq("id", str(agent_id))
                .execute()
            )

            if not result.data:
                raise HTTPException(status_code=404, detail="Agent not found")

            return {"message": "Agent archived successfully"}
        except Exception as e:
            logger.error(f"Error deleting agent {agent_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e)) from e



    def _map_to_response(self, data: Dict[str, Any]) -> AgentResponse:
        # Check WhatsApp Integration
        has_whatsapp = False
        try:
            agent_id = data.get("id")
            if agent_id:
                res = (
                    self.supabase.client.table("integrations")
                    .select("id")
                    .eq("agent_id", agent_id)
                    .eq("provider", "z-api")
                    .eq("is_active", True)
                    .limit(1)
                    .execute()
                )
                has_whatsapp = bool(res.data)
        except Exception:
            pass



        return AgentResponse(
            **data,
            has_whatsapp=has_whatsapp,
        )
